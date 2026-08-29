import { describe, expect, it } from '@jest/globals';
import { captionFor, PHOTO_WINDOW, photoId, remember, resolveDataUrl, type Photo } from '../photos';

const photo = (id: string): Photo => ({
  id,
  uri: `file:///cache/eva/vision/${id}.jpg`,
  dataUrl: `data:image/jpeg;base64,${id}-bytes`,
  takenAt: 0,
});

describe('remember', () => {
  it('keeps the first photo and evicts nothing', () => {
    const r = remember([], photo('a'));
    expect(r.photos.map((p) => p.id)).toEqual(['a']);
    expect(r.evicted).toEqual([]);
  });

  it('holds the window without evicting', () => {
    const r = remember(remember([], photo('a')).photos, photo('b'));
    expect(r.photos.map((p) => p.id)).toEqual(['a', 'b']);
    expect(r.evicted).toEqual([]);
  });

  it('evicts the oldest once the window is full', () => {
    let photos = remember([], photo('a')).photos;
    photos = remember(photos, photo('b')).photos;
    const r = remember(photos, photo('c'));
    expect(r.photos.map((p) => p.id)).toEqual(['b', 'c']);
    // useVision deletes exactly what this names — the cache file for 'a'.
    expect(r.evicted.map((p) => p.id)).toEqual(['a']);
  });

  it('never grows past the window however many are taken', () => {
    let photos: Photo[] = [];
    for (const id of ['a', 'b', 'c', 'd', 'e']) photos = remember(photos, photo(id)).photos;
    expect(photos).toHaveLength(PHOTO_WINDOW);
    expect(photos.map((p) => p.id)).toEqual(['d', 'e']);
  });

  it('does not mutate the list it was given', () => {
    const before = [photo('a'), photo('b')];
    const copy = [...before];
    remember(before, photo('c'));
    expect(before).toEqual(copy);
  });
});

describe('resolveDataUrl', () => {
  const photos = [photo('a'), photo('b')];

  it('returns the data URL for a live photo', () => {
    expect(resolveDataUrl(photos, 'b')).toBe('data:image/jpeg;base64,b-bytes');
  });

  // The null is what makes buildRequest fall back to the caption, and it is
  // also what a session rehydrated from disk gets for every photo it mentions.
  it('returns null for an evicted photo', () => {
    expect(resolveDataUrl(photos, 'gone')).toBeNull();
  });

  it('returns null when nothing is live', () => {
    expect(resolveDataUrl([], 'a')).toBeNull();
  });
});

describe('captionFor', () => {
  it('summarizes what Eva said about the photo', () => {
    expect(captionFor('That is a USB-C hub with four ports.')).toBe('a USB-C hub with four ports');
  });

  it('trims a long description to something a prompt can carry', () => {
    const caption = captionFor('x'.repeat(500));
    expect(caption.length).toBeLessThanOrEqual(120);
  });

  it('falls back to a neutral note when Eva said nothing usable', () => {
    expect(captionFor('')).toBe('a photo');
    expect(captionFor('   ')).toBe('a photo');
  });
});

describe('photoId', () => {
  it('is filesystem-safe and sorts chronologically', () => {
    const early = photoId(Date.UTC(2026, 7, 15, 14, 32, 7));
    const later = photoId(Date.UTC(2026, 7, 15, 14, 32, 8));
    expect(early).not.toMatch(/[:/\\]/);
    expect(early.localeCompare(later)).toBeLessThan(0);
  });
});
