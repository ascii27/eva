import { describe, expect, it } from '@jest/globals';
import {
  ASIDE_INTERVAL_MS,
  decideAside,
  FILLERS,
  noteTool,
  openAside,
  OPENERS,
  TOOL_LINES,
} from '../asides';

const NOW = 1_754_600_000_000;

describe('openAside', () => {
  it('returns an opener and seeds the state', () => {
    const { say, state } = openAside(NOW, 0);
    expect(OPENERS).toContain(say);
    expect(state).toEqual({ lastAsideAt: NOW, pendingTool: null, lastPhrase: say });
  });

  it('is deterministic for a given rand', () => {
    expect(openAside(NOW, 0.5).say).toBe(openAside(NOW, 0.5).say);
  });
});

describe('decideAside', () => {
  const seed = () => openAside(NOW, 0).state;

  it('stays silent before the interval elapses', () => {
    const state = seed();
    const d = decideAside(NOW + ASIDE_INTERVAL_MS - 1, state, 0);
    expect(d.say).toBeNull();
    expect(d.state).toEqual(state); // untouched, including lastAsideAt
  });

  it('speaks a filler once the interval elapses and restamps lastAsideAt', () => {
    const at = NOW + ASIDE_INTERVAL_MS;
    const d = decideAside(at, seed(), 0);
    expect(d.say).not.toBeNull();
    expect(FILLERS).toContain(d.say!);
    expect(d.state.lastAsideAt).toBe(at);
    expect(d.state.lastPhrase).toBe(d.say);
  });

  it('prefers a mapped tool line over a filler and clears pendingTool', () => {
    const state = noteTool(seed(), 'terminal');
    const d = decideAside(NOW + ASIDE_INTERVAL_MS, state, 0);
    expect(TOOL_LINES.terminal).toContain(d.say!);
    expect(d.state.pendingTool).toBeNull();
  });

  it('falls back to the default pool for unknown tool labels', () => {
    const state = noteTool(seed(), 'mystery_gadget');
    const d = decideAside(NOW + ASIDE_INTERVAL_MS, state, 0);
    expect(TOOL_LINES.default).toContain(d.say!);
  });

  it('keeps pendingTool pending while the interval has not elapsed', () => {
    const state = noteTool(seed(), 'terminal');
    const d = decideAside(NOW + 1_000, state, 0);
    expect(d.say).toBeNull();
    expect(d.state.pendingTool).toBe('terminal');
  });

  it('never repeats the previous phrase back to back', () => {
    // With rand=0 both picks would land on the same index without the
    // lastPhrase filter; walk two consecutive fillers and compare.
    const first = decideAside(NOW + ASIDE_INTERVAL_MS, seed(), 0);
    const second = decideAside(NOW + 2 * ASIDE_INTERVAL_MS, first.state, 0);
    expect(second.say).not.toBeNull();
    expect(second.say).not.toBe(first.say);
  });
});

describe('noteTool', () => {
  it('records the label without touching the cadence clock', () => {
    const state = seedState();
    const noted = noteTool(state, 'skill_view');
    expect(noted).toEqual({ ...state, pendingTool: 'skill_view' });
  });

  function seedState() {
    return openAside(NOW, 0).state;
  }
});
