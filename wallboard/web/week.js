// Week in review (ASC-36): when the board shows it, what it says, and who gets
// cheered. Pure, tested (week.test.js); app.js renders and owns the party.
// The numbers come from the server (server/week.ts, `week` in the state).
//
// Never all or nothing: every level gets something warm. Only a perfect week
// gets the star and the full-screen party; anything still open on Sunday is
// an invitation ("2 left today"), never a mark against anyone.

/** Headline per level (server/week.ts `Level`). */
export const LEVEL_WORDS = {
  perfect: 'Perfect week!',
  great: 'Great week',
  good: 'Good week',
  started: 'Off to a start',
  none: 'Fresh start Monday',
};

/** The review is up all of Sunday (outside night mode, which app.js already handles), or when pinned with ?week=1. */
export const showWeek = (weekday, pinned = false) => pinned || weekday === 0;

/** "16–22 Nov", or "30 Nov – 6 Dec" across a month. Days are YYYY-MM-DD. */
export function rangeLabel(start, end) {
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [, sm, sd] = start.split('-').map(Number);
  const [, em, ed] = end.split('-').map(Number);
  return sm === em ? `${sd}–${ed} ${M[em - 1]}` : `${sd} ${M[sm - 1]} – ${ed} ${M[em - 1]}`;
}

/** One person's line under the bar: "12 of 14 done · 2 left today". */
export function metaLine(p) {
  const left = p.level !== 'perfect' && p.left > 0 ? ` · ${p.left} left today` : '';
  return `${p.done} of ${p.due} done${left}`;
}

/** Bar fill, 0–100. */
export const percent = (p) => (p.due > 0 ? Math.round((100 * Math.min(p.done, p.due)) / p.due) : 0);

/** Hanamaru for this person: 'done', 'open' or null when they have none. */
export const hanamaruState = (p) => (!p.hanamaru ? null : p.hanamaru.done >= p.hanamaru.due ? 'done' : 'open');

/**
 * Who has a perfect week that this board hasn't cheered yet. `cheered` is
 * what's remembered ({week, who: []}); a new week starts it over.
 */
export function toCheer(review, cheered) {
  if (!review) return [];
  const seen = cheered?.week === review.start ? cheered.who ?? [] : [];
  return review.people.filter((p) => p.level === 'perfect' && !seen.includes(p.who)).map((p) => p.who);
}

/** `cheered` after cheering `who`. */
export function markCheered(review, cheered, who) {
  const seen = cheered?.week === review.start ? cheered.who ?? [] : [];
  return { week: review.start, who: [...new Set([...seen, ...who])] };
}
