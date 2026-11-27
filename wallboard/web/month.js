// The month sheet (ASC-41, CLAUDE.md "Month calendar"): pure date and layout
// policy, no DOM. Days are "YYYY-MM-DD" strings and months "YYYY-MM", handled
// in UTC so the board's own zone can never shift a day. Weeks start on Monday,
// like the week in review.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Chips a month cell shows; the rest are "+N" beside the date. */
export const CELL_CHIPS = 2;
/** The week view's hours when nothing falls outside them: 7:00 to 21:00. */
export const WEEK_HOURS = [7, 21];

const p2 = (n) => String(n).padStart(2, '0');
const parse = (day) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fmt = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`; };

export function addDays(day, n) { return fmt(parse(day) + n * 86_400_000); }

/** "2026-11" moved by `n` months. */
export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}`;
}

/** 0 = Monday … 6 = Sunday. */
const weekdayIdx = (day) => (new Date(parse(day)).getUTCDay() + 6) % 7;

/** The Monday on or before `day`. */
export const weekStart = (day) => addDays(day, -weekdayIdx(day));

/** The seven days of the week containing `day`, Monday first. */
export const weekDays = (day) => { const s = weekStart(day); return Array.from({ length: 7 }, (_, i) => addDays(s, i)); };

/**
 * Six weeks of days covering `ym`, Monday first. Always six rows, so the grid
 * keeps its size from month to month; days outside the month fill the edges.
 */
export function monthGrid(ym) {
  const s = weekStart(`${ym}-01`);
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(s, w * 7 + d)));
}

/** The months the sheet can show: last month, this month and next month (the server's range). */
export const monthRange = (today) => { const ym = today.slice(0, 7); return [addMonths(ym, -1), ym, addMonths(ym, 1)]; };

/** Move the shown month by `dir`, held inside the range. */
export function stepMonth(ym, dir, today) {
  const r = monthRange(today);
  const i = Math.max(0, Math.min(r.length - 1, r.indexOf(ym) + dir));
  return r[i === -1 ? 1 : i];
}

/** Move the shown week by `dir` weeks, held so it still overlaps the range. */
export function stepWeek(day, dir, today) {
  const [first, , last] = monthRange(today);
  const next = addDays(weekStart(day), 7 * dir);
  const lo = weekStart(`${first}-01`), hi = weekStart(addDays(`${addMonths(last, 1)}-01`, -1));
  return next < lo ? lo : next > hi ? hi : next;
}

export const canStepWeek = (day, dir, today) => stepWeek(day, dir, today) !== weekStart(day);
export const canStepMonth = (ym, dir, today) => stepMonth(ym, dir, today) !== ym;

export const monthLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };

/** "Thursday", "26 November". */
export function dayLabel(day) {
  const [, m, d] = day.split('-').map(Number);
  return { weekday: WEEKDAYS[weekdayIdx(day)], date: `${d} ${MONTHS[m - 1]}` };
}

/** "23 – 29 November 2026", or "30 November – 6 December 2026" across a month. */
export function weekLabel(day) {
  const days = weekDays(day);
  const [y1, m1, d1] = days[0].split('-').map(Number);
  const [y2, m2, d2] = days[6].split('-').map(Number);
  if (y1 !== y2) return `${d1} ${MONTHS[m1 - 1]} ${y1} – ${d2} ${MONTHS[m2 - 1]} ${y2}`;
  if (m1 !== m2) return `${d1} ${MONTHS[m1 - 1]} – ${d2} ${MONTHS[m2 - 1]} ${y2}`;
  return `${d1} – ${d2} ${MONTHS[m2 - 1]} ${y2}`;
}

/** The panel's entries grouped by day, keeping the server's order (all-day first, then time). */
export function byDay(entries) {
  const out = new Map();
  for (const e of entries ?? []) {
    if (!e || typeof e.date !== 'string') continue;
    if (!out.has(e.date)) out.set(e.date, []);
    out.get(e.date).push(e);
  }
  return out;
}

/** Whose colour a chip takes: the one person it's for, or 'shared' for none or several. */
export const toneOf = (e) => (e.who?.length === 1 ? e.who[0] : 'shared');

/** What a month cell shows: the first CELL_CHIPS chips, and how many more there are. */
export function cellChips(list) {
  const all = list ?? [];
  return { chips: all.slice(0, CELL_CHIPS), more: Math.max(0, all.length - CELL_CHIPS) };
}

const hm = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '')); return m ? +m[1] * 60 + +m[2] : null; };

/**
 * The week view: an all-day row per day, and timed events placed on an hour
 * grid. The grid covers WEEK_HOURS, stretched to whole hours to take in
 * anything earlier or later. A missing end is start + 60 min (as on the Today
 * card); an event is never drawn under 30 min tall. Overlapping events share
 * their column in side-by-side lanes.
 *
 * Returns { from, to } in hours, and per day { day, allDay: [...], timed:
 * [{ e, top, height, lane, lanes }] } with top/height in minutes from `from`.
 */
export function weekLayout(days, grouped) {
  const per = days.map((day) => {
    const list = grouped.get(day) ?? [];
    const timed = list.filter((e) => !e.allDay && hm(e.start) != null).map((e) => {
      const s = hm(e.start);
      const end = hm(e.end);
      return { e, s, end: end != null && end > s ? end : s + 60 };
    });
    return { day, allDay: list.filter((e) => e.allDay), timed };
  });
  const all = per.flatMap((d) => d.timed);
  const from = Math.min(WEEK_HOURS[0], ...all.map((t) => Math.floor(t.s / 60)));
  const to = Math.min(24, Math.max(WEEK_HOURS[1], ...all.map((t) => Math.ceil(Math.max(t.end, t.s + 30) / 60))));
  return {
    from,
    to,
    days: per.map((d) => ({ day: d.day, allDay: d.allDay, timed: lanes(d.timed, from) })),
  };
}

/** Greedy lanes within each run of overlapping events. */
function lanes(items, from) {
  const sorted = [...items].sort((a, b) => a.s - b.s || b.end - a.end);
  const out = [];
  let group = [], laneEnds = [], groupEnd = -1;
  const flush = () => { for (const g of group) g.lanes = laneEnds.length; group = []; laneEnds = []; };
  for (const t of sorted) {
    const bottom = Math.max(t.end, t.s + 30);
    if (t.s >= groupEnd) { flush(); groupEnd = -1; }
    let lane = laneEnds.findIndex((end) => end <= t.s);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(bottom); } else laneEnds[lane] = bottom;
    groupEnd = Math.max(groupEnd, bottom);
    const item = { e: t.e, top: t.s - from * 60, height: bottom - t.s, lane, lanes: 1 };
    group.push(item);
    out.push(item);
  }
  flush();
  return out;
}
