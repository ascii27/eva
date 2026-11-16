// The family's day: an iCloud published calendar (webcal) merged with the fixed
// routine (routine.ts), published as the panels the board renders —
// `schedule` (today) and `tomorrow` as event lists (CLAUDE.md "Data"),
// `leave-by`, `bedtime` and `occasions`. The server owns all five; a hermes push to any is
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
import { comingUp, isBirthday, schoolKind, type Occasion } from './occasions.ts';

/** One event, the shape Eva pushes too: `{ id, who, start, end?, title, icon, bring? }`. */
export interface Entry {
  id: string;
  /** "H:MM" Tokyo time, or null for an all-day event. */
  start: string | null;
  end?: string;
  allDay?: true;
  title: string;
  who: string[];
  /** A key in web/icons.js, guessed from the title (iconOf). */
  icon: string;
  sub: string;
}

export interface CalendarPanels {
  schedule: Entry[];
  /** Tomorrow's events with the school run folded in; bedtime left out. */
  tomorrow: Entry[];
  'leave-by': LeaveBy | null;
  /** Same shape as leave-by; the board counts down to it in the 30 min before. */
  bedtime: LeaveBy;
  /** The countdown tile's rotation: next birthday, holiday, school event (occasions.ts). */
  occasions: Occasion[];
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

// Which icon a calendar title gets; the board falls back to a calendar.
const ICON: [RegExp, string][] = [
  [/水泳|スイミング|プール|swim/i, 'swim'],
  [/ピアノ|piano|music|レッスン/i, 'music'],
  [/歯医者|歯科|dentist/i, 'tooth'],
  [/テニス|tennis/i, 'tennis'],
  [/お迎え|迎え|pick ?up/i, 'car'],
  [/仕事|会社|出社|office|work/i, 'work'],
];
export function iconOf(title: string): string {
  return ICON.find(([re]) => re.test(title))?.[1] ?? 'calendar';
}

function subOf(location: string | null): string {
  const first = (location ?? '').split(/\n|\\n/)[0].trim();
  return first.length > 40 ? `${first.slice(0, 39)}…` : first;
}

interface Occurrence { start: number; end: number; allDay: boolean; startDate: string; endDate: string; title: string; location: string | null; recurring: boolean }

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
  const push = (item: ICAL.Event, s: ICAL.Time, e: ICAL.Time | null, recurring = false) => {
    if (String(item.component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED') return;
    const allDay = s.isDate;
    const start = allDay ? midnight(s.toString()) : toMs(s);
    // All-day DTEND is exclusive; a missing one means a single day.
    const end = e ? (allDay ? midnight(e.toString()) : toMs(e)) : allDay ? start + DAY : start;
    if (end <= from && !(end === start && start >= from)) return;
    if (start >= to) return;
    out.push({
      start,
      end,
      allDay,
      startDate: allDay ? s.toString() : tokyoDate(new Date(start)),
      endDate: allDay ? tokyoDate(new Date(end - 1)) : tokyoDate(new Date(start)),
      title: (item.summary ?? '').trim() || '(no title)',
      location: item.location ?? null,
      recurring,
    });
  };

  for (const ev of masters.values()) {
    if (!ev.startDate) continue;
    if (!ev.isRecurring()) { push(ev, ev.startDate, ev.endDate); continue; }
    const it = ev.iterator();
    for (let n = 0, t = it.next(); t && n < 10_000; n++, t = it.next()) {
      if (toMs(t) >= to) break;
      const d = ev.getOccurrenceDetails(t);
      push(d.item, d.startDate, d.endDate, true);
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
    const start = o.allDay ? null : tokyoHM(new Date(o.start));
    const e: Entry = { id: `${o.startDate}-${start ?? 'allday'}-${o.title}`, start, title: o.title, who: whoOf(o.title), icon: iconOf(o.title), sub: subOf(o.location) };
    // A same-day end only; past midnight the default (start + 60) is the better guess.
    if (!o.allDay && o.end > o.start && tokyoDate(new Date(o.end - 1)) === o.startDate) e.end = tokyoHM(new Date(o.end));
    if (o.allDay) e.allDay = true;
    return e;
  };
  const byStart = (a: Occurrence, b: Occurrence) => a.start - b.start || a.title.localeCompare(b.title);

  // Today: all-day events covering today first, then timed events starting today.
  const allDay = occ.filter((o) => o.allDay && o.startDate <= today && o.endDate >= today).sort(byStart);
  const timed = occ.filter((o) => !o.allDay && o.startDate === today).sort(byStart);
  const bed = bedtimeFor(today);
  const bedEntry: Entry = { id: 'bedtime', start: bed.at, title: bed.title, who: bed.who, icon: 'moon', sub: '' };
  const timedEntries = [...timed.map(entry), bedEntry].sort((a, b) => hmKey(a.start!) - hmKey(b.start!));
  const schedule = [...allDay.map(entry), ...timedEntries];

  // Tomorrow, for the after-dinner card and the night view's first commitment:
  // all-day events, then timed ones with the school run among them. Bedtime
  // is routine, not a commitment, so it stays out.
  const tAllDay = occ.filter((o) => o.allDay && o.startDate <= tomorrow && o.endDate >= tomorrow).sort(byStart).map(entry);
  const tTimed = occ.filter((o) => !o.allDay && o.startDate === tomorrow).sort(byStart).map(entry);
  const leaveTomorrow = leaveByFor(tomorrow);
  if (leaveTomorrow) tTimed.push({ id: `school-${tomorrow}`, start: leaveTomorrow.at, title: 'School', who: leaveTomorrow.who, icon: 'bag', sub: '' });
  tTimed.sort((a, b) => hmKey(a.start!) - hmKey(b.start!));

  const birthdays = occ.filter((o) => isBirthday(o.title)).map((o) => {
    const w = whoOf(o.title);
    return { date: o.startDate, title: o.title, who: w.length === 1 ? w[0] : undefined };
  });

  const school = occ.filter((o) => !o.recurring && !isBirthday(o.title) && schoolKind(o.title))
    .map((o) => ({ date: o.startDate, title: o.title }));

  return {
    schedule,
    tomorrow: [...tAllDay, ...tTimed],
    'leave-by': leaveByFor(today),
    bedtime: { label: 'Bedtime', who: bed.who, at: bed.at },
    occasions: comingUp(today, birthdays, school),
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
      for (const name of ['schedule', 'tomorrow', 'leave-by', 'bedtime', 'occasions'] as const) {
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
