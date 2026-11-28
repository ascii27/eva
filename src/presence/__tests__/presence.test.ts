import { describe, expect, it } from '@jest/globals';
import {
  AWAY_SLEEP_MS,
  BUSY_CLEAR_MS,
  GONE_AFTER_MS,
  GREET_AFTER_AWAY_MS,
  GREET_COOLDOWN_MS,
  MOTION_THRESHOLD,
  POLL_INTERVAL_MS,
  greetingFor,
  initialPresence,
  isAway,
  step,
  type PresenceEvent,
  type PresenceState,
  type Sample,
} from '../presence';

const min = 60_000;
const P = POLL_INTERVAL_MS;
const face: Sample = { faces: 1, motion: 0 };
const two: Sample = { faces: 2, motion: 0 };
const empty: Sample = { faces: 0, motion: 0 };
const stir: Sample = { faces: 0, motion: MOTION_THRESHOLD };

/** Feed a script of [t, sample?] and collect every event with its time. */
function run(script: Array<[number, Sample?]>, start = 0) {
  let s: PresenceState = initialPresence(start);
  const events: Array<PresenceEvent & { t: number }> = [];
  for (const [t, sample] of script) {
    const r = step(s, t, sample);
    s = r.state;
    for (const e of r.events) events.push({ ...e, t });
  }
  return { state: s, events, kinds: events.map((e) => e.kind).filter((k) => k !== 'stirred') };
}

/** Looks every POLL_INTERVAL_MS from `from`, `n` of them, all the same. */
const looks = (from: number, n: number, sample: Sample): Array<[number, Sample]> =>
  Array.from({ length: n }, (_, i) => [from + i * P, sample]);

describe('arriving', () => {
  it('one look with a held face arrives', () => {
    const r = run([[P, face]]);
    expect(r.state.here).toBe(true);
    expect(r.kinds).toEqual(['arrived']);
  });

  it('motion alone never arrives, so never greets', () => {
    const r = run(looks(P, 20, stir));
    expect(r.state.here).toBe(false);
    expect(r.kinds).toEqual([]);
  });

  it('away time runs from when they were last seen, not from when we noticed', () => {
    const r = run([[0, face], [10_000, empty], ...looks(10_000 + P, 4, empty), [20 * min, face]]);
    expect(r.kinds).toEqual(['arrived', 'left', 'arrived']);
    expect(r.events.filter((e) => e.kind === 'arrived')[1]).toMatchObject({ awayMs: 20 * min });
  });

  it('starting the camera counts as zero time away, so a launch never greets', () => {
    const r = run([[P, face]], 0);
    expect(r.events.find((e) => e.kind === 'arrived')).toMatchObject({ awayMs: P });
    expect(P).toBeLessThan(GREET_AFTER_AWAY_MS);
  });
});

describe('leaving', () => {
  it('looking away for less than GONE_AFTER_MS is still here', () => {
    const r = run([[0, face], ...looks(P, 2, empty), [3 * P, face]]);
    expect(2 * P).toBeLessThan(GONE_AFTER_MS);
    expect(r.state.here).toBe(true);
    expect(r.kinds).toEqual(['arrived']);
  });

  it('no face and no motion for GONE_AFTER_MS has gone, from the last look that saw them', () => {
    const r = run([[0, face], ...looks(P, 3, empty)]);
    expect(r.kinds).toEqual(['arrived', 'left']);
    expect(r.state.goneSince).toBe(0);
  });

  it('motion keeps someone here when their face is turned away', () => {
    const r = run([[0, face], ...looks(P, 10, stir)]);
    expect(r.state.here).toBe(true);
    expect(r.kinds).toEqual(['arrived']);
  });
});

describe('stirring', () => {
  it('a face or motion stirs; an empty look does not', () => {
    expect(step(initialPresence(0), P, face).events).toContainEqual({ kind: 'stirred' });
    expect(step(initialPresence(0), P, stir).events).toEqual([{ kind: 'stirred' }]);
    expect(step(initialPresence(0), P, empty).events).toEqual([]);
    expect(step(initialPresence(0), P, { faces: 0, motion: MOTION_THRESHOLD / 2 }).events).toEqual([]);
  });

  it('a clock tick without a look never stirs', () => {
    const r = run([[0, face], [P]]);
    expect(r.events.filter((e) => e.kind === 'stirred')).toHaveLength(1);
  });
});

describe('busy room', () => {
  it('a look with two held faces is busy', () => {
    const r = run([[0, two]]);
    expect(r.state.busy).toBe(true);
    expect(r.kinds).toEqual(['arrived', 'busy']);
  });

  it('stays busy until no look has shown two faces for BUSY_CLEAR_MS', () => {
    const r = run([[0, two], ...looks(P, 3, face)]);
    expect(3 * P).toBeLessThan(BUSY_CLEAR_MS);
    expect(r.state.busy).toBe(true);
    const later = step(r.state, BUSY_CLEAR_MS, face);
    expect(later.state.busy).toBe(false);
    expect(later.events).toContainEqual({ kind: 'quiet' });
  });
});

describe('isAway', () => {
  it('is true only after AWAY_SLEEP_MS with nobody here and nothing moving', () => {
    const s = initialPresence(0);
    expect(isAway(s, AWAY_SLEEP_MS - 1)).toBe(false);
    expect(isAway(s, AWAY_SLEEP_MS)).toBe(true);
  });

  it('is never true while someone is here', () => {
    const r = run([[0, face], ...looks(P, 100, stir)]);
    expect(isAway(r.state, 100 * P)).toBe(false);
  });

  it('motion wakes her from away, and the clock starts again from it', () => {
    const r = run([[AWAY_SLEEP_MS, empty]]);
    expect(isAway(r.state, AWAY_SLEEP_MS)).toBe(true);
    const moved = step(r.state, AWAY_SLEEP_MS + P, stir).state;
    expect(isAway(moved, AWAY_SLEEP_MS + P)).toBe(false);
    expect(moved.here).toBe(false);
    expect(isAway(moved, 2 * AWAY_SLEEP_MS + P)).toBe(true);
  });

  it('a passer-by during an absence does not shorten the greeting\'s away time', () => {
    const r = run([[0, face], ...looks(P, 3, empty), [12 * min, stir], [20 * min, face]]);
    expect(r.events.filter((e) => e.kind === 'arrived')[1]).toMatchObject({ awayMs: 20 * min });
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
