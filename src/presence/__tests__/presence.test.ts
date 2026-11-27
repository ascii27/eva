import { describe, expect, it } from '@jest/globals';
import {
  ARRIVE_AFTER_MS,
  AWAY_SLEEP_MS,
  BUSY_AFTER_MS,
  BUSY_CLEAR_MS,
  GONE_AFTER_MS,
  GREET_AFTER_AWAY_MS,
  GREET_COOLDOWN_MS,
  greetingFor,
  initialPresence,
  isAway,
  step,
  type PresenceEvent,
  type PresenceState,
} from '../presence';

const min = 60_000;

/** Feed a script of [t, faces?] and collect every event with its time. */
function run(script: Array<[number, number?]>, start = 0) {
  let s: PresenceState = initialPresence(start);
  const events: Array<PresenceEvent & { t: number }> = [];
  for (const [t, faces] of script) {
    const r = step(s, t, faces);
    s = r.state;
    for (const e of r.events) events.push({ ...e, t });
  }
  return { state: s, events };
}

describe('arriving', () => {
  it('a face held for ARRIVE_AFTER_MS arrives; a glimpse does not', () => {
    const glimpse = run([[1000, 1], [1500, 0], [5000]]);
    expect(glimpse.state.here).toBe(false);
    expect(glimpse.events).toEqual([]);

    const sat = run([[1000, 1], [1000 + ARRIVE_AFTER_MS - 1], [1000 + ARRIVE_AFTER_MS]]);
    expect(sat.state.here).toBe(true);
    expect(sat.events).toEqual([{ kind: 'arrived', awayMs: 1000, t: 1000 + ARRIVE_AFTER_MS }]);
  });

  it('away time runs from when they were last seen, not from when we noticed', () => {
    const r = run([
      [0, 1],
      [ARRIVE_AFTER_MS],
      [10_000, 0],
      [10_000 + GONE_AFTER_MS],
      [20 * min, 1],
      [20 * min + ARRIVE_AFTER_MS],
    ]);
    const kinds = r.events.map((e) => e.kind);
    expect(kinds).toEqual(['arrived', 'left', 'arrived']);
    expect(r.events[2]).toMatchObject({ kind: 'arrived', awayMs: 20 * min - 10_000 });
  });

  it('starting the camera counts as zero time away, so a launch never greets', () => {
    const r = run([[0, 1], [ARRIVE_AFTER_MS]], 0);
    expect(r.events[0]).toMatchObject({ kind: 'arrived', awayMs: 0 });
  });
});

describe('leaving', () => {
  it('looking away for less than GONE_AFTER_MS is still here', () => {
    const r = run([[0, 1], [ARRIVE_AFTER_MS], [5000, 0], [5000 + GONE_AFTER_MS - 1], [5000 + GONE_AFTER_MS - 1, 1]]);
    expect(r.state.here).toBe(true);
    expect(r.events.map((e) => e.kind)).toEqual(['arrived']);
  });

  it('a continuous face keeps lastSeen fresh across ticks', () => {
    const r = run([[0, 1], [ARRIVE_AFTER_MS], [10 * min], [10 * min + 1, 0], [10 * min + GONE_AFTER_MS]]);
    expect(r.events.map((e) => e.kind)).toEqual(['arrived']);
    const later = step(r.state, 10 * min + 1 + GONE_AFTER_MS);
    expect(later.events).toEqual([{ kind: 'left' }]);
    expect(later.state.goneSince).toBe(10 * min + 1);
  });
});

describe('busy room', () => {
  it('two faces held for BUSY_AFTER_MS is busy; a passer-by is not', () => {
    const passing = run([[0, 1], [1000, 2], [3000, 1], [20_000]]);
    expect(passing.state.busy).toBe(false);

    const meeting = run([[0, 2], [BUSY_AFTER_MS]]);
    expect(meeting.state.busy).toBe(true);
    expect(meeting.events.map((e) => e.kind)).toContain('busy');
  });

  it('stays busy until it has been one person for BUSY_CLEAR_MS', () => {
    const r = run([[0, 2], [BUSY_AFTER_MS], [10_000, 1], [10_000 + BUSY_CLEAR_MS - 1]]);
    expect(r.state.busy).toBe(true);
    const later = step(r.state, 10_000 + BUSY_CLEAR_MS);
    expect(later.state.busy).toBe(false);
    expect(later.events).toEqual([{ kind: 'quiet' }]);
  });
});

describe('isAway', () => {
  it('is true only after AWAY_SLEEP_MS with nobody here', () => {
    const s = initialPresence(0);
    expect(isAway(s, AWAY_SLEEP_MS - 1)).toBe(false);
    expect(isAway(s, AWAY_SLEEP_MS)).toBe(true);
  });

  it('is never true while someone is here', () => {
    const r = run([[0, 1], [ARRIVE_AFTER_MS], [AWAY_SLEEP_MS * 2, 0]]);
    expect(isAway(r.state, AWAY_SLEEP_MS * 2 + 1000)).toBe(false);
  });
});

describe('greetingFor', () => {
  const at = (h: number, day = 20) => new Date(2026, 10, day, h, 0, 0, 0);
  const away = GREET_AFTER_AWAY_MS;

  it('greets by the time of day', () => {
    expect(greetingFor({ awayMs: away, busy: false, now: at(8), lastGreetAt: null })).toBe('Good morning.');
    expect(greetingFor({ awayMs: away, busy: false, now: at(14), lastGreetAt: null })).toBe('Good afternoon.');
    expect(greetingFor({ awayMs: away, busy: false, now: at(20), lastGreetAt: null })).toBe('Good evening.');
    expect(greetingFor({ awayMs: away, busy: false, now: at(2), lastGreetAt: null })).toBe("Hi. You're up late.");
  });

  it('stays quiet for a short absence, a busy room, or inside the cooldown', () => {
    expect(greetingFor({ awayMs: away - 1, busy: false, now: at(8), lastGreetAt: null })).toBeNull();
    expect(greetingFor({ awayMs: away, busy: true, now: at(8), lastGreetAt: null })).toBeNull();
    const now = at(14);
    const recent = now.getTime() - GREET_COOLDOWN_MS + 1;
    expect(greetingFor({ awayMs: away, busy: false, now, lastGreetAt: recent })).toBeNull();
  });

  it('a later greeting the same day is a welcome back', () => {
    const morning = at(8).getTime();
    expect(greetingFor({ awayMs: away, busy: false, now: at(14), lastGreetAt: morning })).toBe('Welcome back.');
    // Yesterday's greeting doesn't count.
    expect(greetingFor({ awayMs: away, busy: false, now: at(8, 21), lastGreetAt: at(20).getTime() })).toBe(
      'Good morning.',
    );
  });
});
