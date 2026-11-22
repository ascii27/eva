// What's on in Tokyo (ASC-35): the words and choices for the "This weekend" card,
// the event detail sheet and the browse sheet. Pure — dates in, strings out — so
// it is tested with node:test like chime.js; app.js owns the DOM and the clock.
//
// Every date is a "YYYY-MM-DD" Tokyo date string (the panel's own), handled as
// UTC midnights so the device's timezone never shifts a day.

const DAY = 86_400_000;
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ms = (date) => Date.parse(`${date}T00:00:00Z`);
const ymd = (t) => new Date(t).toISOString().slice(0, 10);
const addDays = (date, n) => ymd(ms(date) + n * DAY);
const weekday = (date) => new Date(ms(date)).getUTCDay();

/** "Sat 28 Nov". */
export function dayLabel(date) {
  const d = new Date(ms(date));
  return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
}

/** "Sat 28" — for day chips, where the month is in the heading. */
export const chipLabel = (date) => dayLabel(date).split(' ').slice(0, 2).join(' ');

/** The Saturday and Sunday of this weekend: the coming one, or the current one on Sat/Sun (as the server's). */
export function weekendOf(today) {
  const wd = weekday(today);
  const sat = wd === 0 ? addDays(today, -1) : addDays(today, (6 - wd + 7) % 7);
  return { sat, sun: addDays(sat, 1) };
}

/** When it's on: "Sat 28 Nov", "Sat 28 Nov – Sun 13 Dec", or "Until Sun 13 Dec" once it has started. */
export function dateLine(e, today) {
  if (e.start === e.end) return dayLabel(e.start);
  if (e.start <= today) return `Until ${dayLabel(e.end)}`;
  return `${dayLabel(e.start)} – ${dayLabel(e.end)}`;
}

/**
 * Its hours, or null when the page gave none. Over several days the page's two
 * times are each day's opening hours, not one long stretch.
 */
export function hoursLine(e) {
  if (!e.time) return null;
  const span = e.until ? `${e.time}–${e.until}` : `From ${e.time}`;
  return e.start === e.end ? span : `${span} each day`;
}

const yen = (n) => `¥${n.toLocaleString('en-US')}`;

/** "¥800–1,500", "¥2,600", "Free", or null when nothing is known (the site writes ¥0 for both). */
export function priceShort(e) {
  if (e.price) return e.price.from === e.price.to ? yen(e.price.from) : `${yen(e.price.from)}–${e.price.to.toLocaleString('en-US')}`;
  return e.free ? 'Free' : null;
}

/** The detail sheet's price row always says something: unknown is said out loud. */
export const priceLine = (e) => priceShort(e) ?? 'Price not listed';

/** Which weekend days it's on: "Sat & Sun", "Sat", "Sun", or null. */
export function weekendDays(e, today) {
  const { sat, sun } = weekendOf(today);
  const on = (d) => e.start <= d && e.end >= d && d >= today;
  return on(sat) && on(sun) ? 'Sat & Sun' : on(sat) ? 'Sat' : on(sun) ? 'Sun' : null;
}

/** The card's second line: "Sat & Sun · 5 km · ¥800–1,500". */
export function cardMeta(e, today) {
  return [weekendDays(e, today) ?? dateLine(e, today), e.km != null ? `${Math.round(e.km)} km` : null, priceShort(e)]
    .filter(Boolean).join(' · ');
}

/** Where: "Toyota Arena Tokyo · Aomi · 9 km". */
export function placeLine(e) {
  const where = [e.venue, e.locality && e.locality !== e.venue ? e.locality : null].filter(Boolean);
  if (e.km != null) where.push(`${Math.round(e.km)} km from home`);
  return where.join(' · ') || null;
}

/**
 * The days a family could go, for the "which day?" chips: every day it's on from
 * today, if that's six or fewer; otherwise the weekend days in the next five
 * weeks, topped up with the earliest days so there are at least two, at most six.
 */
export function dayChoices(e, today) {
  const from = e.start > today ? e.start : today;
  if (from > e.end) return [];
  const all = [];
  for (let d = from; d <= e.end && all.length < 60; d = addDays(d, 1)) all.push(d);
  if (all.length <= 6) return all;
  const horizon = addDays(today, 35);
  const weekends = all.filter((d) => d <= horizon && (weekday(d) === 0 || weekday(d) === 6)).slice(0, 6);
  const picked = new Set(weekends);
  for (const d of all) { if (picked.size >= 2) break; picked.add(d); }
  return [...picked].sort();
}

/** The chip to start on: this weekend's Saturday (or Sunday) if offered, else the first. */
export function defaultDay(choices, today) {
  const { sat, sun } = weekendOf(today);
  return choices.includes(sat) ? sat : choices.includes(sun) ? sun : choices[0] ?? null;
}

/**
 * The card: this weekend's events, planned ones first, or — with nothing on this
 * weekend — the next few, under a different heading. Null when there are no events.
 */
export function cardEvents(list, plans, today) {
  if (!list?.length) return null;
  const planned = new Set((plans ?? []).filter((p) => p.want === 'add').map((p) => p.id));
  const byPlan = (a, b) => Number(planned.has(b.id)) - Number(planned.has(a.id));
  const weekend = list.filter((e) => weekendDays(e, today));
  if (weekend.length) return { title: 'This weekend', items: weekend.slice().sort(byPlan) };
  return { title: 'Coming up in Tokyo', items: list.slice() };
}

/**
 * What a plan says about an event, for the card and the sheet:
 * { state, label, day } — state is adding | added | removing | add-failed | remove-failed.
 */
export function planState(plan) {
  if (!plan) return null;
  const day = dayLabel(plan.day);
  if (plan.want === 'add') {
    if (plan.status === 'pending') return { state: 'adding', label: 'Asking Eva to add it', day };
    if (plan.status === 'done') return { state: 'added', label: `On the calendar · ${day}`, day };
    return { state: 'add-failed', label: `Eva couldn’t add it${plan.note ? `: ${plan.note}` : ''}`, day };
  }
  if (plan.status === 'pending') return { state: 'removing', label: 'Asking Eva to take it off', day };
  return { state: 'remove-failed', label: `Eva couldn’t take it off${plan.note ? `: ${plan.note}` : ''}`, day };
}

/** One page of the browse sheet: `size` events from page `n` (clamped), and how many pages there are. */
export function page(list, n, size = 8) {
  const pages = Math.max(1, Math.ceil(list.length / size));
  const p = Math.min(Math.max(0, n), pages - 1);
  return { items: list.slice(p * size, p * size + size), page: p, pages };
}
