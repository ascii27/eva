// The countdown tile's rotation ("Coming up", ASC-25). Pure: lists in, one
// list out, so it is testable without a DOM.
//
// What rotates: everything Eva pushed in `countdowns`, plus the server's
// `occasions` (the nearest birthday, major holiday and school event,
// server/occasions.ts). Eva's push wins a clash: a default on the same day as
// one of hers, with the same kind or the same label, is the same occasion told
// twice, so hers stays and the default goes.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const sameDay = (a, b) => DATE.test(a?.date ?? '') && a.date === b?.date;

/**
 * @param {object[] | null} pushed    Eva's `countdowns` panel data, or null when absent
 * @param {object[] | null} defaults  the server's `occasions`, or null when absent
 * @param {number} today              UTC ms of the board's local midnight (Date.UTC(y, m, d))
 * @returns {object[]} nearest first, each with `days`; past and undated ones dropped
 */
export function comingUp(pushed, defaults, today) {
  const mine = pushed ?? [];
  const theirs = (defaults ?? []).filter((d) =>
    !mine.some((p) => sameDay(p, d) && ((p.kind ?? 'visit') === d.kind || p.label === d.label)));
  return [...mine, ...theirs]
    .map((c) => (DATE.test(c?.date ?? '') ? { ...c, days: Math.round((Date.parse(`${c.date}T00:00:00Z`) - today) / 86_400_000) } : c))
    .filter((c) => Number.isFinite(Number(c?.days)) && Number(c.days) >= 0)
    .sort((a, b) => a.days - b.days);
}

/** Which item the tile shows on step `n` of the rotation; null when there's nothing. */
export const shownAt = (list, n) => (list.length ? list[((n % list.length) + list.length) % list.length] : null);
