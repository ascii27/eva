// The board's state and every way it can change. Pure: no I/O, no clock, no
// randomness — callers pass `at` and event ids. Kept this way so it is testable
// with node:test and so the server stays a thin shell around it, the same split
// as src/agent/history.ts.
//
// Split ownership, so nothing ever conflicts:
//   - Notion (via hermes) owns chore *definitions*: title, who, icon, amount,
//     schedule. hermes pushes the whole list; the board never polls.
//   - The board owns *activity*: when a chore is next due, whether it was done
//     today, and an append-only log of completions, undos and payments. The
//     girls' allowance is computed from that log, never stored.
//
// The log is never edited: an undo is a new `undone` event that cancels an
// earlier one. Every event carries `delta`, its signed change to what is owed,
// so the balance is the sum of the log.
//
// Absent vs empty, as on the desk: a panel missing from `panels` means "Eva
// never told us"; a panel present with empty data means "there is nothing".

import { firstOnOrAfter, nextAfter, parseSchedule, tokyoDay, type Schedule } from './schedule.ts';

export interface ChoreDef {
  id: string;
  title: string;
  /** Who it belongs to, or null for anyone. */
  who: string | null;
  /** Icon key the board knows (see web/icons.js); null for the generic check. */
  icon: string | null;
  /** Integer yen earned per completion; snapshotted onto each `done` event. */
  amount: number;
  schedule: Schedule;
}

export interface Chore extends ChoreDef {
  /** Shown as to-do when nextDue <= today, so an overdue chore carries over. */
  nextDue: string;
  /** Shown as done when doneOn === today. */
  doneOn: string | null;
  /** nextDue before today's tick, for undo. */
  prevDue: string | null;
  /** Id of today's `done` event, for undo. */
  doneEvent: string | null;
}

interface Base {
  id: string;
  seq: number;
  at: number;
  who: string;
  /** Signed change to what is owed. */
  delta: number;
}

export type LogEvent =
  | (Base & { type: 'done'; choreId: string; title: string; amount: number })
  | (Base & { type: 'undone'; cancels: string; choreId: string | null; title: string | null })
  | (Base & { type: 'payment'; amount: number; source: 'board' | 'eva'; note: string | null });

export interface Panel {
  data: unknown;
  updatedAt: number;
}

export interface BoardState {
  /** Bumped on every change, so a client can tell a stale broadcast from a new one. */
  version: number;
  /** Random per log; a new one tells hermes the board lost its history. */
  logId: string;
  /** Highest event seq so far. */
  seq: number;
  chores: Chore[];
  log: LogEvent[];
  panels: Record<string, Panel>;
}

export type Action =
  | { type: 'chore.set'; id: string; done: boolean; at: number; eventId: string }
  | { type: 'chores.replace'; chores: ChoreDef[]; at: number }
  | { type: 'payment'; eventId: string; who: string; amount: number; source: 'board' | 'eva'; note: string | null; at: number }
  /** Payments only: a completion is undone with chore.set. */
  | { type: 'cancel'; eventId: string; cancels: string; at: number }
  | { type: 'panel.set'; name: string; data: unknown; at: number }
  | { type: 'panel.clear'; name: string };

/** Log `who` for a chore that belongs to nobody in particular. */
const ANYONE = 'anyone';

export function emptyState(logId: string): BoardState {
  return { version: 0, logId, seq: 0, chores: [], log: [], panels: {} };
}

type NewEvent = LogEvent extends infer E ? (E extends LogEvent ? Omit<E, 'seq'> : never) : never;

function append(s: BoardState, chores: Chore[], e: NewEvent): BoardState {
  const seq = s.seq + 1;
  return { ...s, version: s.version + 1, seq, chores, log: [...s.log, { ...e, seq } as LogEvent] };
}

const hasEvent = (s: BoardState, id: string) => s.log.some((e) => e.id === id);

/** Largest yen amount accepted anywhere (chore amount or payment), either sign. */
export const MAX_YEN = 1_000_000;

/** A safe integer within ±MAX_YEN. */
export const isYen = (v: unknown): v is number => Number.isSafeInteger(v) && Math.abs(v as number) <= MAX_YEN;

const isCancelled = (s: BoardState, id: string) => s.log.some((e) => e.type === 'undone' && e.cancels === id);

/**
 * The latest uncancelled completion of a chore, from the log. The log outlives
 * a chore's place on the board, so this is how a chore that drops out of one
 * push and comes back keeps its phase and can't be ticked twice in a day.
 */
function lastDone(s: BoardState, choreId: string): Extract<LogEvent, { type: 'done' }> | null {
  for (let i = s.log.length - 1; i >= 0; i--) {
    const e = s.log[i];
    if (e.type === 'done' && e.choreId === choreId && !isCancelled(s, e.id)) return e;
  }
  return null;
}

const sameSchedule = (a: Schedule, b: Schedule) => a.every === b.every && a.unit === b.unit && a.start === b.start;

/**
 * Runtime for a chore new to the board. With no history it starts at
 * schedule.start, even if that is past (it shows as overdue). A chore that was
 * on the board before — dropped by one push, back in the next — is seeded from
 * its latest uncancelled completion: done today stays done (undo restores it to
 * its first day on or after today), and either way it is next due on the first
 * occurrence after that completion, so it keeps its phase.
 */
function seeded(s: BoardState, def: ChoreDef, today: string): Chore {
  const last = lastDone(s, def.id);
  if (!last) return { ...def, nextDue: def.schedule.start, doneOn: null, prevDue: null, doneEvent: null };
  const day = tokyoDay(last.at);
  const nextDue = nextAfter(def.schedule, day);
  if (day === today) {
    return { ...def, nextDue, doneOn: today, prevDue: firstOnOrAfter(def.schedule, today), doneEvent: last.id };
  }
  return { ...def, nextDue, doneOn: null, prevDue: null, doneEvent: null };
}

/**
 * Why a board "Mark paid" for `amount` can't go through, or null if it can. The
 * button pays exactly what is owed, so anything else — a second tap after the
 * first landed, a balance that moved underneath it — is a conflict, not a payment.
 */
export function boardPayConflict(s: BoardState, who: string, amount: number): string | null {
  const owed = balances(s)[who]?.owed ?? 0;
  if (owed <= 0) return 'nothing is owed';
  if (amount !== owed) return 'amount does not match what is owed';
  return null;
}

/** Returns the next state, or null when the action changes nothing (unknown id, etc). */
export function apply(s: BoardState, a: Action): BoardState | null {
  switch (a.type) {
    case 'chore.set': {
      // Set, not toggle: the board's undo sends the state it wants back, so a
      // double tap or a retried request can't flip it the wrong way.
      const i = s.chores.findIndex((c) => c.id === a.id);
      if (i < 0 || hasEvent(s, a.eventId)) return null;
      const c = s.chores[i];
      const today = tokyoDay(a.at);
      const chores = s.chores.slice();
      if (a.done) {
        if (c.nextDue > today || c.doneOn === today) return null;
        // Belt and braces for the runtime fields: the log is the money, so one
        // uncancelled completion per chore per Tokyo day, whatever they say.
        const last = lastDone(s, c.id);
        if (last && tokyoDay(last.at) === today) return null;
        chores[i] = { ...c, prevDue: c.nextDue, nextDue: nextAfter(c.schedule, today), doneOn: today, doneEvent: a.eventId };
        return append(s, chores, {
          type: 'done', id: a.eventId, at: a.at, who: c.who ?? ANYONE, delta: c.amount,
          choreId: c.id, title: c.title, amount: c.amount,
        });
      }
      // Undo only until midnight: after that the tick is history.
      if (c.doneOn !== today || c.prevDue === null || c.doneEvent === null) return null;
      const done = s.log.find((e) => e.id === c.doneEvent);
      chores[i] = { ...c, nextDue: c.prevDue, doneOn: null, prevDue: null, doneEvent: null };
      return append(s, chores, {
        type: 'undone', id: a.eventId, at: a.at, who: done?.who ?? c.who ?? ANYONE, delta: -(done?.delta ?? 0),
        cancels: c.doneEvent, choreId: c.id, title: c.title,
      });
    }
    case 'chores.replace': {
      // Progress survives a re-push: Eva re-sending the list must not un-tick
      // what a kid just ticked. A changed schedule re-anchors to the new one.
      const today = tokyoDay(a.at);
      const prev = new Map(s.chores.map((c) => [c.id, c]));
      const chores = a.chores.map((def): Chore => {
        const old = prev.get(def.id);
        if (!old) return seeded(s, def, today);
        const runtime = { nextDue: old.nextDue, doneOn: old.doneOn, prevDue: old.prevDue, doneEvent: old.doneEvent };
        if (sameSchedule(old.schedule, def.schedule)) return { ...def, ...runtime };
        if (old.doneOn === today) {
          return { ...def, ...runtime, prevDue: firstOnOrAfter(def.schedule, today), nextDue: nextAfter(def.schedule, today) };
        }
        return { ...def, ...runtime, nextDue: firstOnOrAfter(def.schedule, today) };
      });
      return { ...s, version: s.version + 1, chores };
    }
    case 'payment': {
      // Idempotent on the caller's id, so a retried request doesn't pay twice.
      // Negative is allowed: an opening-balance credit.
      if (!isYen(a.amount) || a.amount === 0 || hasEvent(s, a.eventId)) return null;
      return append(s, s.chores, {
        type: 'payment', id: a.eventId, at: a.at, who: a.who, delta: -a.amount,
        amount: a.amount, source: a.source, note: a.note,
      });
    }
    case 'cancel': {
      const target = s.log.find((e) => e.id === a.cancels);
      if (!target || target.type !== 'payment' || hasEvent(s, a.eventId)) return null;
      if (s.log.some((e) => e.type === 'undone' && e.cancels === a.cancels)) return null;
      return append(s, s.chores, {
        type: 'undone', id: a.eventId, at: a.at, who: target.who, delta: -target.delta,
        cancels: target.id, choreId: null, title: null,
      });
    }
    case 'panel.set':
      return {
        ...s,
        version: s.version + 1,
        panels: { ...s.panels, [a.name]: { data: a.data, updatedAt: a.at } },
      };
    case 'panel.clear': {
      if (!(a.name in s.panels)) return null;
      const panels = { ...s.panels };
      delete panels[a.name];
      return { ...s, version: s.version + 1, panels };
    }
  }
}

export interface Balance {
  earned: number;
  paid: number;
  /** earned − paid; equals the sum of every event's delta. */
  owed: number;
  /** Latest uncancelled payment with a positive amount. */
  lastPaidAt: number | null;
}

/** Per person, for everyone named by a chore or the log. */
export function balances(s: BoardState): Record<string, Balance> {
  const cancelled = new Set(s.log.flatMap((e) => (e.type === 'undone' ? [e.cancels] : [])));
  const out: Record<string, Balance> = {};
  const get = (who: string) => (out[who] ??= { earned: 0, paid: 0, owed: 0, lastPaidAt: null });
  for (const c of s.chores) if (c.who !== null) get(c.who);
  for (const e of s.log) {
    const b = get(e.who);
    if (e.type === 'undone' || cancelled.has(e.id)) continue;
    if (e.type === 'done') b.earned += e.amount;
    else {
      b.paid += e.amount;
      if (e.amount > 0 && (b.lastPaidAt === null || e.at > b.lastPaidAt)) b.lastPaidAt = e.at;
    }
  }
  for (const b of Object.values(out)) b.owed = b.earned - b.paid;
  return out;
}

export interface ViewChore {
  id: string;
  title: string;
  who: string | null;
  icon: string | null;
  amount: number;
  done: boolean;
}

/** What the board shows at `at`: today's chores (due or done today), balances and panels. */
export function view(
  s: BoardState,
  at: number,
): { version: number; chores: ViewChore[]; balances: Record<string, Balance>; panels: Record<string, Panel> } {
  const today = tokyoDay(at);
  const chores = s.chores.flatMap((c): ViewChore[] => {
    const done = c.doneOn === today;
    if (!done && c.nextDue > today) return [];
    return [{ id: c.id, title: c.title, who: c.who, icon: c.icon, amount: c.amount, done }];
  });
  return { version: s.version, chores, balances: balances(s), panels: s.panels };
}

/** Events with seq > after, oldest first, plus what hermes needs to spot a reset board. */
export function activityAfter(s: BoardState, after: number): { logId: string; seq: number; events: LogEvent[] } {
  return { logId: s.logId, seq: s.seq, events: s.log.filter((e) => e.seq > after) };
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const PANEL_NAME = /^[a-z][a-z0-9-]{0,31}$/;

/** Validates a pushed chore list. Returns the list, or an error string. */
export function parseChores(body: unknown): ChoreDef[] | string {
  const list = (body as { chores?: unknown } | null)?.chores;
  if (!Array.isArray(list)) return 'expected {"chores": [...]}';
  const seen = new Set<string>();
  const out: ChoreDef[] = [];
  for (const [i, raw] of list.entries()) {
    const c = raw as Record<string, unknown> | null;
    if (!c || typeof c !== 'object') return `chores[${i}]: not an object`;
    if (typeof c.id !== 'string' || !ID.test(c.id)) return `chores[${i}].id: invalid`;
    if (seen.has(c.id)) return `chores[${i}].id: duplicate "${c.id}"`;
    if (typeof c.title !== 'string' || !c.title.trim()) return `chores[${i}].title: required`;
    if (c.who != null && typeof c.who !== 'string') return `chores[${i}].who: must be a string`;
    if (c.icon != null && typeof c.icon !== 'string') return `chores[${i}].icon: must be a string`;
    if ('done' in c) return `chores[${i}].done: not accepted, the board owns done-ness`;
    if (!isYen(c.amount) || c.amount < 0) {
      return `chores[${i}].amount: must be an integer from 0 to ${MAX_YEN}`;
    }
    const schedule = parseSchedule(c.schedule);
    if (typeof schedule === 'string') return `chores[${i}].schedule: ${schedule}`;
    seen.add(c.id);
    out.push({
      id: c.id,
      title: c.title.trim(),
      who: (c.who as string | undefined) ?? null,
      icon: (c.icon as string | undefined) ?? null,
      amount: c.amount,
      schedule,
    });
  }
  return out;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayOrNull = (v: unknown): string | null => (typeof v === 'string' && DAY.test(v) ? v : null);

function reviveChore(raw: unknown): Chore | null {
  const c = raw as Record<string, unknown> | null;
  if (!c || typeof c !== 'object' || typeof c.id !== 'string' || typeof c.title !== 'string') return null;
  const schedule = parseSchedule(c.schedule);
  if (typeof schedule === 'string') return null;
  return {
    id: c.id,
    title: c.title,
    who: typeof c.who === 'string' ? c.who : null,
    icon: typeof c.icon === 'string' ? c.icon : null,
    amount: typeof c.amount === 'number' && Number.isInteger(c.amount) && c.amount >= 0 ? c.amount : 0,
    schedule,
    nextDue: dayOrNull(c.nextDue) ?? schedule.start,
    doneOn: dayOrNull(c.doneOn),
    prevDue: dayOrNull(c.prevDue),
    doneEvent: typeof c.doneEvent === 'string' ? c.doneEvent : null,
  };
}

/**
 * Parses a saved state file, falling back to empty on anything unexpected.
 * Files written before a field existed get it filled in: a missing log gets
 * `newLogId`, and chores without a valid schedule are dropped (hermes re-pushes
 * them from Notion).
 */
export function reviveState(raw: unknown, newLogId: string): BoardState {
  const s = raw as Record<string, unknown> | null;
  if (!s || typeof s !== 'object' || !Array.isArray(s.chores) || typeof s.panels !== 'object' || !s.panels) {
    return emptyState(newLogId);
  }
  const log = Array.isArray(s.log)
    ? (s.log as LogEvent[]).filter((e) => e && typeof e === 'object' && typeof e.id === 'string' && typeof e.seq === 'number')
    : [];
  const maxSeq = log.reduce((n, e) => Math.max(n, e.seq), 0);
  return {
    version: typeof s.version === 'number' ? s.version : 0,
    logId: typeof s.logId === 'string' && s.logId ? s.logId : newLogId,
    seq: typeof s.seq === 'number' ? Math.max(s.seq, maxSeq) : maxSeq,
    chores: s.chores.map(reviveChore).filter((c): c is Chore => c !== null),
    log,
    panels: s.panels as Record<string, Panel>,
  };
}
