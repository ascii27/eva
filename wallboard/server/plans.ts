// Plans (ASC-35): Tokyo events the family asked Eva to put on — or take off —
// the family calendar, from the board. Pure, like state.ts, which stores them.
//
// The board can't write the calendar (it only reads the published iCloud link),
// and hermes is never called from here: it runs a scheduled job (the `eva-events`
// skill) that reads the pending plans, makes the calendar match with its own
// calendar tools, and reports back. So a plan is a request plus its outcome:
//
//   want: 'add' | 'remove'   — what the family asked for, last tap wins
//   status: 'pending'        — hermes hasn't done it yet
//           'done'           — the calendar matches (a done remove is deleted)
//           'failed'         — hermes couldn't; `note` says why, the board offers a retry
//
// hermes' job is "make the calendar match `want`", not "perform this action", so
// a change of mind while a request is pending needs no cancellation protocol:
// the next run simply sees the latest `want`. hermes reports with the `want` it
// acted on; a report for a superseded `want` is refused (409) and it re-reads.
//
// A plan carries a snapshot of the event (title, day, time, venue, link), so it
// outlives the event leaving the feed, and hermes needs nothing but the plan.

export type Want = 'add' | 'remove';

export interface Plan {
  /** The event's id in the `tokyo-events` panel ("tc-402638"). */
  id: string;
  title: string;
  url: string;
  /** The day it goes on the calendar ("YYYY-MM-DD"): the family picks one of a multi-day event's days. */
  day: string;
  /** "H:MM" times from the event page; absent means all-day. For a multi-day event they're that day's hours. */
  time?: string;
  until?: string;
  venue?: string;
  /** "Aomi, Suburban East Tokyo": where, for the calendar entry's location. */
  place?: string;
  want: Want;
  status: 'pending' | 'done' | 'failed';
  /** hermes' one-line reason, on failure. */
  note?: string;
  /** hermes' id for the calendar entry it made, so a later remove finds the right one. */
  ref?: string;
  requestedAt: number;
  updatedAt: number;
}

/** What the board knows about an event when someone taps "add". */
export interface EventSnapshot {
  id: string;
  title: string;
  url: string;
  start: string;
  end: string;
  time?: string;
  until?: string;
  venue?: string;
  locality?: string;
  region?: string;
}

export type Plans = Record<string, Plan>;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The family asks to add `ev` on `day`. Returns the new plans, null when nothing
 * changes (already asked for, already on), or an error string.
 */
export function requestAdd(plans: Plans, ev: EventSnapshot, day: string, today: string, at: number): Plans | null | string {
  if (!DAY.test(day)) return 'day must be YYYY-MM-DD';
  if (day < today) return 'that day has passed';
  if (day < ev.start || day > ev.end) return 'the event is not on that day';
  const old = plans[ev.id];
  if (old && old.want === 'add' && old.day === day && old.status !== 'failed') return null;
  // A different day for an event already on the calendar is a move: hermes makes
  // the calendar match, so the plan keeps its `ref` for hermes to find the old entry.
  const place = [ev.locality, ev.region].filter(Boolean).join(', ');
  const plan: Plan = {
    id: ev.id, title: ev.title, url: ev.url, day,
    ...(ev.time ? { time: ev.time } : {}), ...(ev.until ? { until: ev.until } : {}),
    ...(ev.venue ? { venue: ev.venue } : {}), ...(place ? { place } : {}),
    want: 'add', status: 'pending',
    ...(old?.ref ? { ref: old.ref } : {}),
    requestedAt: at, updatedAt: at,
  };
  return { ...plans, [ev.id]: plan };
}

/** The family asks to take an event off. Returns the new plans, null when nothing changes. */
export function requestRemove(plans: Plans, id: string, at: number): Plans | null {
  const old = plans[id];
  if (!old) return null;
  if (old.want === 'remove' && old.status === 'pending') return null;
  // An add that failed put nothing on the calendar: there is nothing to take off.
  if (old.want === 'add' && old.status === 'failed' && !old.ref) {
    const next = { ...plans };
    delete next[id];
    return next;
  }
  const { note: _n, ...rest } = old;
  return { ...plans, [id]: { ...rest, want: 'remove', status: 'pending', requestedAt: at, updatedAt: at } };
}

export interface Report { want: Want; result: 'done' | 'failed'; note?: string; ref?: string }

/**
 * hermes reports what it did for the `want` it read. 'missing' (no such plan)
 * and 'stale' (the family changed its mind since) are refusals; null is a
 * repeat of a report already applied.
 */
export function resolve(plans: Plans, id: string, r: Report, at: number): Plans | null | 'missing' | 'stale' {
  const old = plans[id];
  if (!old) return r.want === 'remove' && r.result === 'done' ? null : 'missing'; // a repeated "removed"
  if (old.want !== r.want) return 'stale';
  if (old.status !== 'pending') {
    const same = old.status === (r.result === 'done' ? 'done' : 'failed');
    return same ? null : 'stale';
  }
  if (r.want === 'remove' && r.result === 'done') {
    const next = { ...plans };
    delete next[id];
    return next;
  }
  const { note: _n, ...rest } = old;
  const plan: Plan = { ...rest, status: r.result === 'done' ? 'done' : 'failed', updatedAt: at };
  if (r.result === 'failed' && r.note) plan.note = r.note;
  if (r.ref) plan.ref = r.ref;
  return { ...plans, [id]: plan };
}

/** Drop plans for days that have passed: what's done is on the calendar, what isn't no longer matters. */
export function prune(plans: Plans, today: string): Plans | null {
  const keep = Object.values(plans).filter((p) => p.day >= today);
  return keep.length === Object.keys(plans).length ? null : Object.fromEntries(keep.map((p) => [p.id, p]));
}

/** Pending first (oldest request first), then by day. What hermes reads. */
export function planList(plans: Plans): Plan[] {
  const rank = (p: Plan) => (p.status === 'pending' ? 0 : 1);
  return Object.values(plans).sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? a.requestedAt - b.requestedAt : a.day.localeCompare(b.day)));
}

const str = (v: unknown, max: number) => (typeof v === 'string' && v.length <= max ? v : undefined);

/** Parses saved plans, dropping anything malformed. */
export function revivePlans(raw: unknown): Plans {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Plans = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const p = v as Record<string, unknown> | null;
    if (!p || typeof p !== 'object' || p.id !== id) continue;
    const title = str(p.title, 300), url = str(p.url, 1000), day = str(p.day, 10);
    if (!title || !url || !day || !DAY.test(day)) continue;
    if (p.want !== 'add' && p.want !== 'remove') continue;
    if (p.status !== 'pending' && p.status !== 'done' && p.status !== 'failed') continue;
    const plan: Plan = {
      id, title, url, day, want: p.want, status: p.status,
      requestedAt: typeof p.requestedAt === 'number' ? p.requestedAt : 0,
      updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : 0,
    };
    for (const k of ['time', 'until', 'venue', 'place', 'note', 'ref'] as const) {
      const s = str(p[k], 500);
      if (s) plan[k] = s;
    }
    out[id] = plan;
  }
  return out;
}

/** hermes' report body. Returns the report or an error string. */
export function parseReport(body: unknown): Report | string {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') return 'expected a JSON body';
  if (b.want !== 'add' && b.want !== 'remove') return 'want must be "add" or "remove"';
  if (b.result !== 'done' && b.result !== 'failed') return 'result must be "done" or "failed"';
  if (b.note !== undefined && (typeof b.note !== 'string' || b.note.length > 200)) return 'note must be a string of at most 200 characters';
  if (b.ref !== undefined && (typeof b.ref !== 'string' || !b.ref || b.ref.length > 500)) return 'ref must be a non-empty string of at most 500 characters';
  if (b.result === 'failed' && !b.note) return 'a failed report needs a note saying why';
  return { want: b.want, result: b.result, ...(b.note ? { note: b.note as string } : {}), ...(b.ref ? { ref: b.ref as string } : {}) };
}
