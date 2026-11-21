// Bath order (ASC-34): the girls alternate who bathes first, every night.
//
// The board keeps `{date, tonight, history}` (in this browser's localStorage;
// there is no server model yet). `rollBath` carries it forward to today: for
// each day that has passed, last night's first goes on the history and the
// other girl is up. Swap just changes `tonight`, so tomorrow alternates from
// whoever actually went first, and a swap shows in the history like any night.
// Pure so it can be tested under node; app.js owns the clock and storage.

export const HISTORY = 5;                 // nights shown under "Went first"
export const other = (id) => (id === 'mariko' ? 'sarina' : 'mariko');

/** "2026-11-18" → a day number, independent of the host timezone. */
const dayNum = (s) => Math.round(Date.parse(`${s}T00:00:00Z`) / 86_400_000);

/**
 * `bath` as of `today` ("YYYY-MM-DD", the board's local date). A state with no
 * date (saved before rotation existed) is taken as today's, so nothing jumps.
 * A date in the future (a clock that went backwards) is left alone.
 */
export function rollBath(bath, today) {
  const history = Array.isArray(bath?.history) ? [...bath.history] : [];
  let tonight = bath?.tonight === 'mariko' || bath?.tonight === 'sarina' ? bath.tonight : 'sarina';
  if (!bath?.date || !Number.isFinite(dayNum(bath.date))) return { date: today, tonight, history: history.slice(-HISTORY) };
  const gap = dayNum(today) - dayNum(bath.date);
  if (!(gap > 0)) return { date: bath.date, tonight, history: history.slice(-HISTORY) };
  // Only the last few nights can show, and the order is fixed by parity, so a
  // board that was off for months doesn't loop through every one of them.
  const steps = Math.min(gap, HISTORY + (gap % 2 === HISTORY % 2 ? 0 : 1));
  if (steps < gap) tonight = (gap - steps) % 2 ? other(tonight) : tonight;
  for (let i = 0; i < steps; i++) { history.push(tonight); tonight = other(tonight); }
  return { date: today, tonight, history: history.slice(-HISTORY) };
}
