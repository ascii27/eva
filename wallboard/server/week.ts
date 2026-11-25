// Week in review (ASC-36): what each person got done Monday to Sunday, from the
// board's own log. Pure, like state.ts: the caller passes `at`.
//
// The week is Monday–Sunday in Tokyo. It counts the *whole* week, today
// included, so on Sunday a chore ticked at 21:00 still makes the week — the
// board shows the review all of Sunday and it fills in live.
//
// "Due" is how many times a chore's schedule falls inside the week (from its
// start, if that's mid-week). "Done" is how many uncancelled completions landed
// inside it, capped at due: a weekly chore overdue from last week and also due
// this week can be ticked twice, but that's catching up, not extra credit. A
// chore with no occurrence this week that was still ticked (an overdue one
// carried over) counts as due and done, once per tick, so catching up shows.
//
// Not all or nothing: `level` grades the week so the board and Eva can cheer a
// good week too, and `left` is what is still on the board today — the part of
// the week that can still be finished before midnight.
//
// Hanamaru homework is a chore like any other (Notion → eva-chores), found by
// its title or its icon, and reported on its own as well.

import { firstOnOrAfter, tokyoDay, type Schedule } from './schedule.ts';
import type { BoardState } from './state.ts';

export type Level = 'perfect' | 'great' | 'good' | 'started' | 'none';

export interface WeekChore {
  id: string;
  title: string;
  icon: string | null;
  due: number;
  done: number;
  hanamaru: boolean;
}

export interface WeekPerson {
  who: string;
  due: number;
  done: number;
  /** Chores still on the board today (due or overdue, not ticked): can still be done before midnight. */
  left: number;
  level: Level;
  /** Hanamaru homework this week, or null when this person has none. */
  hanamaru: { due: number; done: number } | null;
  chores: WeekChore[];
}

export interface WeekReview {
  /** Monday, YYYY-MM-DD. */
  start: string;
  /** Sunday, YYYY-MM-DD. */
  end: string;
  /** Today is the week's last day. */
  sunday: boolean;
  people: WeekPerson[];
}

const DAY_MS = 86_400_000;
const toNum = (day: string): number => Math.floor(Date.parse(day + 'T00:00:00Z') / DAY_MS);
const fromNum = (n: number): string => new Date(n * DAY_MS).toISOString().slice(0, 10);

/** Monday and Sunday of the week holding `day`. */
export function weekOf(day: string): { start: string; end: string } {
  const n = toNum(day);
  const dow = new Date(n * DAY_MS).getUTCDay();          // 0 = Sunday
  const start = n - ((dow + 6) % 7);
  return { start: fromNum(start), end: fromNum(start + 6) };
}

/** How many occurrences of `s` fall in [from, to], both inclusive. */
export function occurrences(s: Schedule, from: string, to: string): number {
  const first = firstOnOrAfter(s, from);
  if (first > to) return 0;
  const step = s.every * (s.unit === 'week' ? 7 : 1);
  return Math.floor((toNum(to) - toNum(first)) / step) + 1;
}

const HANAMARU = /hanamaru|はなまる|花丸/i;
export const isHanamaru = (c: { title: string; icon: string | null }): boolean =>
  HANAMARU.test(c.title) || (c.icon !== null && HANAMARU.test(c.icon));

export function levelOf(done: number, due: number): Level {
  if (due === 0 || done === 0) return 'none';
  if (done >= due) return 'perfect';
  const r = done / due;
  return r >= 0.75 ? 'great' : r >= 0.4 ? 'good' : 'started';
}

/** The week holding `at`, per person with chores, from the current chore list and the log. */
export function weekReview(s: BoardState, at: number): WeekReview {
  const today = tokyoDay(at);
  const { start, end } = weekOf(today);
  const cancelled = new Set(s.log.flatMap((e) => (e.type === 'undone' ? [e.cancels] : [])));
  const ticks = new Map<string, number>();
  for (const e of s.log) {
    if (e.type !== 'done' || cancelled.has(e.id)) continue;
    const day = tokyoDay(e.at);
    if (day >= start && day <= end) ticks.set(e.choreId, (ticks.get(e.choreId) ?? 0) + 1);
  }

  const byWho = new Map<string, WeekPerson>();
  for (const c of s.chores) {
    if (c.who === null) continue;
    const occ = occurrences(c.schedule, start, end);
    const ticked = ticks.get(c.id) ?? 0;
    const due = occ > 0 ? occ : ticked;
    if (due === 0) continue;
    const p = byWho.get(c.who) ?? { who: c.who, due: 0, done: 0, left: 0, level: 'none' as Level, hanamaru: null, chores: [] };
    const done = Math.min(ticked, due);
    const hanamaru = isHanamaru(c);
    p.chores.push({ id: c.id, title: c.title, icon: c.icon, due, done, hanamaru });
    p.due += due;
    p.done += done;
    if (c.nextDue <= today && c.doneOn !== today) p.left += 1;
    if (hanamaru) p.hanamaru = { due: (p.hanamaru?.due ?? 0) + due, done: (p.hanamaru?.done ?? 0) + done };
    byWho.set(c.who, p);
  }
  const people = [...byWho.values()].map((p) => ({ ...p, level: levelOf(p.done, p.due) }));
  return { start, end, sunday: today === end, people };
}
