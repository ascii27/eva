import { describe, expect, it } from '@jest/globals';
import {
  budgetCore,
  CORE_BUDGET_TOKENS,
  OUT_OF_SYNC_AFTER_MS,
  parseBundle,
  QUIET_AFTER_MS,
  refreshInterval,
  REFRESH_ACTIVE_MS,
  REFRESH_QUIET_MS,
  renderCore,
  renderVolatile,
  staleness,
  STALE_AFTER_MS,
  type Bundle,
} from '../bundle';

const AT = '2026-08-21T14:00:00Z';
const AT_MS = Date.parse(AT);

const raw = (extra: Record<string, unknown> = {}) => JSON.stringify({ generatedAt: AT, ...extra });

/** A parsed bundle with everything absent but the stamp — the parser's floor. */
const bare = (): Bundle => parseBundle(raw({ goals: [] }))!;

describe('parseBundle', () => {
  it('reads a whole-response object', () => {
    const b = parseBundle(raw({ goals: ['Ship the bridge'] }));
    expect(b?.generatedAt).toBe(AT_MS);
    expect(b?.goals).toEqual(['Ship the bridge']);
  });

  it('digs the object out of a fenced block', () => {
    const b = parseBundle('Here you go:\n```json\n' + raw({ goals: ['a'] }) + '\n```\n');
    expect(b?.goals).toEqual(['a']);
  });

  it('digs the object out of surrounding prose', () => {
    const b = parseBundle(`Sure. ${raw({ goals: ['a'] })} Let me know if you need more.`);
    expect(b?.goals).toEqual(['a']);
  });

  // The invariant the whole failure story rests on: a bad fetch keeps the
  // previous bundle, and there is no path by which it becomes an empty one.
  it('returns null rather than a partial on unparseable input', () => {
    expect(parseBundle('')).toBeNull();
    expect(parseBundle('I could not reach the calendar.')).toBeNull();
    expect(parseBundle('{ "generatedAt": ')).toBeNull();
  });

  it('returns null when the stamp is missing or unreadable', () => {
    // An undateable bundle cannot be aged, and one presented as fresh is exactly
    // the failure the staleness machinery exists to prevent. Keeping the older,
    // correctly-dated bundle is the safe direction.
    expect(parseBundle(JSON.stringify({ goals: ['a'] }))).toBeNull();
    expect(parseBundle(JSON.stringify({ generatedAt: 'soon', goals: ['a'] }))).toBeNull();
  });

  it('returns null for a dated object carrying no recognised section', () => {
    // Distinguishes "hermes says the day is empty" from "hermes returned
    // something that is not a bundle at all".
    expect(parseBundle(raw({ error: 'calendar unreachable' }))).toBeNull();
  });

  it('keeps present-but-empty distinct from absent', () => {
    const b = parseBundle(raw({ calendar: { next12h: [] } }))!;
    expect(b.calendar.next12h).toEqual([]); // he really has nothing on
    expect(b.calendar.next72h).toBeNull(); // we simply were not told
    expect(b.tasks.today).toBeNull();
  });

  it('tolerates unknown fields and wrong types without losing the rest', () => {
    const b = parseBundle(raw({ goals: 'not an array', people: ['Ana'], mood: 'chipper' }));
    expect(b?.goals).toBeNull();
    expect(b?.people).toEqual(['Ana']);
  });

  it('drops non-string and blank entries', () => {
    expect(parseBundle(raw({ goals: ['  keep  ', '', 7, null, 'also'] }))?.goals).toEqual(['keep', 'also']);
  });

  it('reads temporal fields, and tolerates their absence', () => {
    expect(parseBundle(raw({ temporal: { timezone: 'America/Denver', dayContext: 'workday' } }))?.temporal).toEqual({
      timezone: 'America/Denver',
      dayContext: 'workday',
    });
    expect(bare().temporal).toEqual({ timezone: null, dayContext: null });
  });
});

describe('renderCore', () => {
  it('is byte-identical for two bundles differing only in their stamp', () => {
    // The reason the core/volatile split exists: an unchanged refresh must not
    // invalidate the cached prefix, so freshness cannot live in the core.
    const a = parseBundle(raw({ goals: ['Ship it'] }))!;
    const b = parseBundle(JSON.stringify({ generatedAt: '2026-08-21T15:30:00Z', goals: ['Ship it'] }))!;
    expect(renderCore(a)).toBe(renderCore(b));
  });

  it('says nothing at all about the age of the picture', () => {
    const text = renderCore(parseBundle(raw({ goals: ['a'] }))!);
    expect(text).not.toMatch(/ago|minute|stale|sync/i);
  });

  it('states an empty section rather than omitting it', () => {
    expect(renderCore(parseBundle(raw({ calendar: { next12h: [] } }))!)).toMatch(/nothing/i);
  });

  it('omits a section we were never given', () => {
    const text = renderCore(parseBundle(raw({ goals: ['a'] }))!);
    expect(text).not.toMatch(/twelve hours/i);
  });

  it('carries the entries through', () => {
    const text = renderCore(parseBundle(raw({ calendar: { next12h: ['Nakamura call at two'] } }))!);
    expect(text).toContain('Nakamura call at two');
  });
});

describe('renderVolatile', () => {
  it('reports the age of the picture', () => {
    expect(renderVolatile(bare(), AT_MS + 3 * 60_000)).toMatch(/three minutes/i);
  });

  it('says nothing about hedging while it is fresh', () => {
    expect(renderVolatile(bare(), AT_MS + 60_000)).not.toMatch(/out of sync/i);
  });

  it('asks for hedging once stale', () => {
    const text = renderVolatile(bare(), AT_MS + STALE_AFTER_MS + 1);
    expect(text).toMatch(/may have (moved|changed)/i);
  });

  it('admits being out of sync past the second threshold', () => {
    expect(renderVolatile(bare(), AT_MS + OUT_OF_SYNC_AFTER_MS + 1)).toMatch(/out of sync/i);
  });

  it('treats a stamp from the future as fresh rather than negative', () => {
    expect(renderVolatile(bare(), AT_MS - 60_000)).not.toMatch(/out of sync/i);
  });
});

describe('staleness', () => {
  it('turns over at ten and thirty minutes', () => {
    expect(staleness(AT_MS, AT_MS)).toBe('fresh');
    expect(staleness(AT_MS, AT_MS + STALE_AFTER_MS - 1)).toBe('fresh');
    expect(staleness(AT_MS, AT_MS + STALE_AFTER_MS)).toBe('stale');
    expect(staleness(AT_MS, AT_MS + OUT_OF_SYNC_AFTER_MS - 1)).toBe('stale');
    expect(staleness(AT_MS, AT_MS + OUT_OF_SYNC_AFTER_MS)).toBe('outOfSync');
  });
});

describe('budgetCore', () => {
  /** Enough filler to blow the budget several times over. */
  const fat = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag} ${i} ${'x'.repeat(200)}`);

  const overfull = (): Bundle =>
    parseBundle(
      raw({
        goals: fat(5, 'goal'),
        calendar: { next12h: fat(5, 'soon'), next72h: fat(20, 'later') },
        tasks: { today: fat(20, 'task'), overdue: fat(10, 'late'), deferred: fat(10, 'punted') },
        people: fat(20, 'person'),
        decisions: fat(20, 'decision'),
        openLoops: { waitingOn: fat(10, 'waiting'), owes: fat(10, 'owes') },
        identity: ['on a plane'],
        temporal: { timezone: 'America/Denver', dayContext: 'travelling' },
      }),
    )!;

  it('brings an oversized bundle under budget', () => {
    const cut = budgetCore(overfull());
    expect(renderCore(cut).length / 4).toBeLessThanOrEqual(CORE_BUDGET_TOKENS);
  });

  it('leaves a bundle that already fits completely alone', () => {
    const b = parseBundle(raw({ goals: ['Ship it'], people: ['Ana'] }))!;
    expect(budgetCore(b)).toEqual(b);
  });

  it('never drops identity, temporal, goals, or the next twelve hours', () => {
    const cut = budgetCore(overfull());
    expect(cut.identity).toEqual(['on a plane']);
    expect(cut.temporal.dayContext).toBe('travelling');
    expect(cut.goals).toHaveLength(5);
    expect(cut.calendar.next12h).toHaveLength(5);
  });

  it('drops people before decisions, and decisions before tasks', () => {
    const cut = budgetCore(overfull());
    const left = (xs: string[] | null) => xs?.length ?? 0;
    expect(left(cut.people)).toBeLessThanOrEqual(left(cut.decisions));
    expect(left(cut.decisions)).toBeLessThanOrEqual(left(cut.tasks.today));
  });

  it('keeps a section present-but-empty rather than making it absent', () => {
    // Truncation must not be able to turn "you have no meetings" into "I was
    // never told about your meetings" — those are different sentences.
    const cut = budgetCore(overfull());
    expect(cut.people).not.toBeNull();
  });
});

describe('refreshInterval', () => {
  const now = AT_MS;

  it('holds the fast cadence while someone has been in the room', () => {
    expect(refreshInterval(now, now)).toBe(REFRESH_ACTIVE_MS);
    expect(refreshInterval(now, now - QUIET_AFTER_MS + 1)).toBe(REFRESH_ACTIVE_MS);
  });

  it('backs off once the room has been quiet for an hour', () => {
    // 150s forever is ~576 hermes runs a day, most of them at night, in the dark,
    // for nobody.
    expect(refreshInterval(now, now - QUIET_AFTER_MS)).toBe(REFRESH_QUIET_MS);
    expect(refreshInterval(now, now - 8 * 3_600_000)).toBe(REFRESH_QUIET_MS);
  });

  it('treats never-interacted as quiet rather than as infinitely active', () => {
    expect(refreshInterval(now, 0)).toBe(REFRESH_QUIET_MS);
  });
});
