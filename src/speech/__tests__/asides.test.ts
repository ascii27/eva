import { describe, expect, it } from '@jest/globals';
import {
  ASIDE_INTERVAL_MS,
  ASIDE_OPENER_DELAY_MS,
  beginAside,
  decideAside,
  FILLERS,
  noteTool,
  OPENERS,
  TOOL_LINES,
} from '../asides';

const NOW = 1_754_600_000_000;
/** When the opener first becomes due. */
const OPENED_AT = NOW + ASIDE_OPENER_DELAY_MS;
/** State as it is once the opener has already been spoken. */
const seed = () => decideAside(OPENED_AT, beginAside(NOW), 0).state;

describe('beginAside', () => {
  it('speaks nothing on its own — the opener is now a decideAside decision', () => {
    const state = beginAside(NOW);
    expect(state.openerSpoken).toBe(false);
    expect(state.startedAt).toBe(NOW);
    expect(state.lastPhrase).toBeNull();
    expect(state.pendingTool).toBeNull();
  });
});

describe('decideAside — the delayed opener', () => {
  it('stays silent before the grace period elapses', () => {
    expect(decideAside(OPENED_AT - 1, beginAside(NOW), 0).say).toBeNull();
  });

  it('speaks an opener once the grace period elapses', () => {
    const d = decideAside(OPENED_AT, beginAside(NOW), 0);
    expect(OPENERS).toContain(d.say);
    expect(d.state.openerSpoken).toBe(true);
    expect(d.state.lastAsideAt).toBe(OPENED_AT);
  });

  it('narrates a pending tool instead of an opener when one is already known', () => {
    const d = decideAside(OPENED_AT, noteTool(beginAside(NOW), 'terminal'), 0);
    expect(TOOL_LINES.terminal).toContain(d.say!);
    expect(d.state.pendingTool).toBeNull();
    expect(d.state.openerSpoken).toBe(true);
  });

  it('speaks the opener only once', () => {
    expect(decideAside(OPENED_AT + 1, seed(), 0).say).toBeNull();
  });

  it('is deterministic for a given rand', () => {
    expect(decideAside(OPENED_AT, beginAside(NOW), 0.5).say).toBe(
      decideAside(OPENED_AT, beginAside(NOW), 0.5).say,
    );
  });

  it('never repeats the opener as the first filler', () => {
    const opened = decideAside(OPENED_AT, beginAside(NOW), 0);
    for (let r = 0; r < 10; r++) {
      const filler = decideAside(OPENED_AT + ASIDE_INTERVAL_MS, opened.state, r / 10);
      expect(filler.say).not.toBe(opened.say);
    }
  });
});

describe('decideAside — filler cadence', () => {
  it('stays silent before the interval elapses', () => {
    const state = seed();
    const d = decideAside(OPENED_AT + ASIDE_INTERVAL_MS - 1, state, 0);
    expect(d.say).toBeNull();
    expect(d.state).toEqual(state); // untouched, including lastAsideAt
  });

  it('speaks a filler once the interval elapses and restamps lastAsideAt', () => {
    const at = OPENED_AT + ASIDE_INTERVAL_MS;
    const d = decideAside(at, seed(), 0);
    expect(d.say).not.toBeNull();
    expect(FILLERS).toContain(d.say!);
    expect(d.state.lastAsideAt).toBe(at);
    expect(d.state.lastPhrase).toBe(d.say);
  });

  it('prefers a mapped tool line over a filler and clears pendingTool', () => {
    const state = noteTool(seed(), 'terminal');
    const d = decideAside(OPENED_AT + ASIDE_INTERVAL_MS, state, 0);
    expect(TOOL_LINES.terminal).toContain(d.say!);
    expect(d.state.pendingTool).toBeNull();
  });

  it('falls back to the default pool for unknown tool labels', () => {
    const state = noteTool(seed(), 'mystery_gadget');
    const d = decideAside(OPENED_AT + ASIDE_INTERVAL_MS, state, 0);
    expect(TOOL_LINES.default).toContain(d.say!);
  });

  it('keeps pendingTool pending while the interval has not elapsed', () => {
    const state = noteTool(seed(), 'terminal');
    const d = decideAside(OPENED_AT + 1_000, state, 0);
    expect(d.say).toBeNull();
    expect(d.state.pendingTool).toBe('terminal');
  });

  it('never repeats the previous phrase back to back', () => {
    // With rand=0 both picks would land on the same index without the
    // lastPhrase filter; walk two consecutive fillers and compare.
    const first = decideAside(OPENED_AT + ASIDE_INTERVAL_MS, seed(), 0);
    const second = decideAside(OPENED_AT + 2 * ASIDE_INTERVAL_MS, first.state, 0);
    expect(second.say).not.toBeNull();
    expect(second.say).not.toBe(first.say);
  });
});

describe('noteTool', () => {
  it('records the label without touching the cadence clock', () => {
    const state = seed();
    expect(noteTool(state, 'skill_view')).toEqual({ ...state, pendingTool: 'skill_view' });
  });
});
