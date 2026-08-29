// The photo window: which captured frames are still live, which have aged out,
// and what a turn says about a photo it can no longer show. Pure, no I/O.
//
// A photo exists in two places at once, and keeping them straight is this
// file's job. The bytes are a cache file plus a data URL, held only in memory
// for as long as the window keeps them. The *reference* is a `Turn.photo`
// carrying an id and a caption, and that is the only part that ever reaches
// disk — which is what stops base64 leaking into the archived sessions
// `store.ts` writes. When the window drops a photo, `resolveDataUrl` starts
// returning null for it and `buildRequest` renders the caption instead.

/** A live photo: the file on disk, the bytes for the request, and its id. */
export interface Photo {
  /** Chronological, filesystem-safe; also the cache filename. */
  id: string;
  /** file:// URI of the downscaled JPEG, for the side column thumbnail. */
  uri: string;
  /** `data:image/jpeg;base64,…`, what actually goes to OpenAI. */
  dataUrl: string;
  takenAt: number;
}

export interface RememberResult {
  photos: Photo[];
  /** Aged out of the window — their cache files are now the caller's to delete. */
  evicted: Photo[];
}

/**
 * How many photos stay attached to the conversation.
 *
 * Two is enough for "what about the left side?" to work against the photo just
 * taken while still holding the one before it, and it bounds what a long
 * session re-sends every turn. At `detail: low` an image is a flat ~85 prompt
 * tokens, so the window costs less than a paragraph of history.
 */
export const PHOTO_WINDOW = 2;

/** Longest caption carried in a turn — it is prompt text, read by the model. */
const MAX_CAPTION = 120;

/** What a turn says when the photo itself is gone. */
const NO_CAPTION = 'a photo';

/**
 * Millisecond ISO stamp with the separators swapped out: safe as a filename on
 * every platform, and still sorts lexicographically in chronological order.
 * Same trick as `history.sessionId`, at finer resolution — two photos in one
 * session can land in the same second only if something has gone wrong, but
 * colliding ids would silently overwrite a cache file.
 */
export function photoId(takenAt: number): string {
  return new Date(takenAt).toISOString().replace(/[:.]/g, '-');
}

/**
 * Add a photo, dropping whatever no longer fits. Returns a new list — the
 * caller deletes the cache files named by `evicted`.
 */
export function remember(photos: Photo[], photo: Photo): RememberResult {
  const all = [...photos, photo];
  const keep = all.slice(-PHOTO_WINDOW);
  return { photos: keep, evicted: all.slice(0, all.length - keep.length) };
}

/**
 * The bytes for a photo id, or null when it is no longer live. Null is the
 * normal case for anything older than the window, and for every photo in a
 * session rehydrated from disk after a relaunch — the cache does not survive.
 */
export function resolveDataUrl(photos: Photo[], id: string): string | null {
  return photos.find((p) => p.id === id)?.dataUrl ?? null;
}

// Eva answers in prose ("That's a USB-C hub with four ports"), and the caption
// is read back to her later as a noun phrase, so the lead-in has to go.
const LEAD_IN = /^(?:that(?:'|’)?s|that is|this is|it(?:'|’)?s|it is|looks like|i see|i can see)\s+/i;

/**
 * The stand-in text for a photo that has aged out, built from what Eva said
 * about it at the time. This is all that survives of an image, so it is worth
 * being a description rather than a placeholder: "(photo taken earlier: a
 * USB-C hub)" still lets her follow a reference back.
 */
export function captionFor(description: string): string {
  const text = description.trim().replace(LEAD_IN, '').replace(/[.!?]+$/, '').trim();
  if (!text) return NO_CAPTION;
  if (text.length <= MAX_CAPTION) return text;
  // Cut at a word boundary rather than mid-word; the ellipsis is spoken by
  // nobody, it only ever reaches the model.
  const cut = text.slice(0, MAX_CAPTION - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > 40 ? cut.slice(0, at) : cut).trimEnd()}…`;
}
