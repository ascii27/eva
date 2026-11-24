// The calm weather card's faces (ASC-27): a tap rotates now → hourly → daily →
// now, and a rotated card goes back to now on its own after WX_BACK_MS. Pure;
// app.js owns the tap and the timer.

/** How long a rotated card stays rotated before it returns to now. */
export const WX_BACK_MS = 3 * 60_000;

const ORDER = ['now', 'hourly', 'daily'];

/** The faces this panel can draw, in tap order. A face with no data is skipped. */
export function wxFaces(w) {
  if (!w?.now) return [];
  return ORDER.filter((f) => f === 'now' || (Array.isArray(w[f]) && w[f].length > 0));
}

/** The face to draw: the one asked for while it still has data, else now. */
export function wxFace(face, w) {
  return wxFaces(w).includes(face) ? face : 'now';
}

/** The face after a tap on `face`. */
export function nextWxFace(face, w) {
  const faces = wxFaces(w);
  if (!faces.length) return 'now';
  return faces[(faces.indexOf(wxFace(face, w)) + 1) % faces.length];
}
