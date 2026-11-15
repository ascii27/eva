// The family's day: an iCloud published calendar (webcal) merged with the fixed
// routine (routine.ts), published as three panels the board already renders —
// `schedule` (today), `tomorrow` (the night view's first commitment),
// `leave-by`, `bedtime` and `occasion`. The server owns all five; a hermes push to any is
// overwritten.
//
// The URL is a capability: anyone holding it can read the calendar. It lives
// only in /etc/wallboard.env on the VM and is never logged.
//
// Parsing is ical.js (timezones from the feed's own VTIMEZONEs, RRULE/EXDATE,
// RECURRENCE-ID overrides). Events arrive in Los Angeles, Tokyo and fixed-offset
// zones; everything is shown in Tokyo time. Japan has no DST, so a Tokyo day is
// always [YYYY-MM-DDT00:00+09:00, +24h).

import ICAL from 'ical.js';
import { bedtimeFor, leaveByFor, type LeaveBy } from './routine.ts';
import { isBirthday, nextOccasion, type Occasion } from './occasions.ts';

export interface Entry {
  /** "H:MM" Tokyo time, or null for an all-day event. */
  at: string | null;
  allDay?: true;
  title: string;
  who: string[];
  sub: string;
}

export interface CalendarPanels {
  schedule: Entry[];
  tomorrow: { at: string; title: string } | null;
  'leave-by': LeaveBy | null;
  /** Same shape as leave-by; the board counts down to it in the 30 min before. */
  bedtime: LeaveBy;
  /** The countdown tile's default: next birthday or major holiday (occasions.ts). */
  occasion: Occasion;
}

const TZ = 'Asia/Tokyo';
const DAY = 86_400_000;

/** "2026-11-15" for the Tokyo calendar day containing `d`. */
export function tokyoDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function tokyoHM(d: Date): string {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const h = Number(p.find((x) => x.type === 'hour')!.value);
  return `${h}:${p.find((x) => x.type === 'minute')!.value}`;
}

const midnight = (date: string) => Date.parse(`${date}T00:00:00+09:00`);

/** A floating time (no zone) is read as Tokyo, not as the VM's UTC. */
function toMs(t: ICAL.Time): number {
  const tzid = t.zone?.tzid;
  if (tzid && tzid !== 'floating') return t.toJSDate().getTime();
  const p = (n: number) => String(n).padStart(2, '0');
  return Date.parse(`${t.year}-${p(t.month)}-${p(t.day)}T${p(t.hour)}:${p(t.minute)}:${p(t.second)}+09:00`);
}

// Who an event is for, from its title. Titles are mostly Japanese; "キッズ"
// (kids) means both girls.
const WHO: [RegExp, string[]][] = [
  [/まりこ|マリコ|mariko/i, ['mariko']],
  [/さりな|サリナ|sarina/i, ['sarina']],
  [/のぞみ|ノゾミ|nozomi/i, ['nozomi']],
  [/マイケル|michael/i, ['michael']],
  [/キッズ|kids|girls/i, ['mariko', 'sarina']],
];
export function whoOf(title: string): string[] {
  const out = new Set<string>();
  for (const [re, ids] of WHO) if (re.test(title)) ids.forEach((i) => out.add(i));
  return ['mariko', 'sarina', 'nozomi', 'michael'].filter((i) => out.has(i));
}

function subOf(location: string | null): string {
  const first = (location ?? '').split(/\n|\\n/)[0].trim();
  return first.length > 40 ? `${first.slice(0, 39)}…` : first;
}

interface Occurrence { start: number; allDay: boolean; startDate: string; endDate: string; title: string; location: string | null }

/** Every occurrence overlapping [from, to), recurring events expanded. */
function occurrences(ics: string, from: number, to: number): Occurrence[] {
  const root = new ICAL.Component(ICAL.parse(ics));
  for (const tz of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz);

  const masters = new Map<string, ICAL.Event>();
  const exceptions: ICAL.Component[] = [];
  for (const c of root.getAllSubcomponents('vevent')) {
    if (c.hasProperty('recurrence-id')) exceptions.push(c);
    else masters.set(String(c.getFirstPropertyValue('uid')), new ICAL.Event(c));
  }
  for (const c of exceptions) {
    const m = masters.get(String(c.getFirstPropertyValue('uid')));
    if (m) m.relateException(c);
    else masters.set(`${c.getFirstPropertyValue('uid')}#${c.getFirstPropertyValue('recurrence-id')}`, new ICAL.Event(c));
  }

  const out: Occurrence[] = [];
  const push = (item: ICAL.Event, s: ICAL.Time, e: ICAL.Time | null) => {
    if (String(item.component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED') return;
    const allDay = s.isDate;
    const start = allDay ? midnight(s.toString()) : toMs(s);
    // All-day DTEND is exclusive; a missing one means a single day.
    const end = e ? (allDay ? midnight(e.toString()) : toMs(e)) : allDay ? start + DAY : start;
    if (end <= from && !(end === start && start >= from)) return;
    if (start >= to) return;
    out.push({
      start,
      allDay,
      startDate: allDay ? s.toString() : tokyoDate(new Date(start)),
      endDate: allDay ? tokyoDate(new Date(end - 1)) : tokyoDate(new Date(start)),
      title: (item.summary ?? '').trim() || '(no title)',
      location: item.location ?? null,
    });
  };

  for (const ev of masters.values()) {
    if (!ev.startDate) continue;
    if (!ev.isRecurring()) { push(ev, ev.startDate, ev.endDate); continue; }
    const it = ev.iterator();
    for (let n = 0, t = it.next(); t && n < 10_000; n++, t = it.next()) {
      if (toMs(t) >= to) break;
      const d = ev.getOccurrenceDetails(t);
      push(d.item, d.startDate, d.endDate);
    }
  }
  return out;
}

const hmKey = (hm: string) => { const [h, m] = hm.split(':').map(Number); return h * 60 + m; };

/**
 * The day's panels for the Tokyo day containing `now`: the calendar (if any)
 * merged with the routine (routine.ts). The leave-by is its own panel — the
 * board folds it into the schedule itself, inside its window.
 */
export function calendarPanels(ics: string | null, now: Date): CalendarPanels {
  const today = tokyoDate(now);
  const t0 = midnight(today);
  const tomorrow = tokyoDate(new Date(t0 + DAY + 1));
  // A year ahead, so birthdays are in reach of the countdown tile.
  const occ = ics ? occurrences(ics, t0, t0 + 367 * DAY) : [];

  const entry = (o: Occurrence): Entry => {
    const e: Entry = { at: o.allDay ? null : tokyoHM(new Date(o.start)), title: o.title, who: whoOf(o.title), sub: subOf(o.location) };
    if (o.allDay) e.allDay = true;
    return e;
  };
  const byStart = (a: Occurrence, b: Occurrence) => a.start - b.start || a.title.localeCompare(b.title);

  // Today: all-day events covering today first, then timed events starting today.
  const allDay = occ.filter((o) => o.allDay && o.startDate <= today && o.endDate >= today).sort(byStart);
  const timed = occ.filter((o) => !o.allDay && o.startDate === today).sort(byStart);
  const bed = bedtimeFor(today);
  const timedEntries = [...timed.map(entry), bed].sort((a, b) => hmKey(a.at!) - hmKey(b.at!));
  const schedule = [...allDay.map(entry), ...timedEntries];

  // Night view: tomorrow's first commitment — the school run or a timed event,
  // whichever is earlier. Bedtime never counts as a commitment.
  const cands: { at: string; title: string }[] = occ
    .filter((o) => !o.allDay && o.startDate === tomorrow)
    .map((o) => ({ at: tokyoHM(new Date(o.start)), title: `Tomorrow · ${o.title}` }));
  const leaveTomorrow = leaveByFor(tomorrow);
  if (leaveTomorrow) cands.push({ at: leaveTomorrow.at, title: 'Tomorrow · leave for school' });
  cands.sort((a, b) => hmKey(a.at) - hmKey(b.at));

  const birthdays = occ.filter((o) => isBirthday(o.title)).map((o) => {
    const w = whoOf(o.title);
    return { date: o.startDate, title: o.title, who: w.length === 1 ? w[0] : undefined };
  });

  return {
    schedule,
    tomorrow: cands[0] ?? null,
    'leave-by': leaveByFor(today),
    bedtime: { label: 'Bedtime', who: bed.who, at: bed.at },
    occasion: nextOccasion(today, birthdays),
  };
}

/** webcal:// is just https:// with a different scheme. */
export const httpsUrl = (url: string) => url.replace(/^webcals?:\/\//i, 'https://');

/**
 * Fetch every `fetchMs`; recompute every minute from the last good copy, so
 * the day rolls over at midnight without waiting for a fetch. A failed fetch
 * keeps the last copy: an absent panel would fall back to dummy events.
 */
export function startCalendar(url: string | undefined, fetchMs: number, publish: (name: keyof CalendarPanels, data: unknown) => void): void {
  let ics: string | null = null;
  const last: Record<string, string> = {};
  const recompute = () => {
    // With a URL, wait for the first fetch rather than publish a calendar-less day.
    if (url && ics == null) return;
    try {
      const p = calendarPanels(ics, new Date());
      for (const name of ['schedule', 'tomorrow', 'leave-by', 'bedtime', 'occasion'] as const) {
        const key = JSON.stringify(p[name]);
        if (key !== last[name]) { last[name] = key; publish(name, p[name]); }
      }
    } catch (e) {
      console.error('[calendar] parse failed:', e instanceof Error ? e.message : e);
    }
  };
  const fetchIcs = async (src: string) => {
    try {
      const r = await fetch(httpsUrl(src), { signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      ics = await r.text();
      recompute();
    } catch (e) {
      // Never log the URL: it is the calendar's only secret.
      const cause = e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e);
      console.error(`[calendar] fetch failed: ${cause}`);
    }
  };
  setInterval(recompute, 60_000).unref();
  if (!url) { recompute(); return; }
  void fetchIcs(url);
  setInterval(() => fetchIcs(url), fetchMs).unref();
}
