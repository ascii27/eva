import { describe, expect, it } from '@jest/globals';
import type { SseEvent } from '../../agent/sse';
import { startedTools } from '../progress';

/**
 * Payloads measured against the live gateway with
 * `PROBE_RAW=1 npm run probe:brain -- 5`, verbatim:
 *
 *   {"tool":"terminal","emoji":"…","label":"date '+…'","toolCallId":"call_x","status":"running"}
 *   {"tool":"terminal","toolCallId":"call_x","status":"completed"}
 */
const progress = (body: Record<string, unknown>): SseEvent => ({
  name: 'hermes.tool.progress',
  data: JSON.stringify(body),
});

describe('startedTools', () => {
  it('names a tool that has just started', () => {
    const events = [progress({ tool: 'terminal', toolCallId: 'call_x', status: 'running' })];
    expect(startedTools(events)).toEqual(['terminal']);
  });

  it('ignores the completion of a tool it already reported', () => {
    // onToolStart means "the reply pauses here". The completion frame is the
    // reply resuming, which the next content delta already says.
    const events = [progress({ tool: 'terminal', toolCallId: 'call_x', status: 'completed' })];
    expect(startedTools(events)).toEqual([]);
  });

  it('names every tool started in the same read', () => {
    const events = [
      progress({ tool: 'calendar', status: 'running' }),
      progress({ tool: 'todoist', status: 'running' }),
    ];
    expect(startedTools(events)).toEqual(['calendar', 'todoist']);
  });

  it('reports a tool once however many frames it sends', () => {
    const events = [
      progress({ tool: 'calendar', toolCallId: 'a', status: 'running' }),
      progress({ tool: 'calendar', toolCallId: 'b', status: 'running' }),
    ];
    expect(startedTools(events)).toEqual(['calendar']);
  });

  it('ignores an event that is not tool progress', () => {
    expect(startedTools([{ name: 'hermes.something.else', data: '{"status":"running"}' }])).toEqual([]);
  });

  it('survives a payload that is not JSON', () => {
    // Same rule as the tools: never throw. By the time one of these arrives the
    // preamble is usually already being spoken, and losing the round over a bad
    // frame is worse than missing a tool line.
    const events: SseEvent[] = [{ name: 'hermes.tool.progress', data: 'not json' }];
    expect(() => startedTools(events)).not.toThrow();
    expect(startedTools(events)).toEqual([]);
  });

  it('skips a running frame with no tool name', () => {
    expect(startedTools([progress({ status: 'running' })])).toEqual([]);
  });

  it('returns nothing for an empty read', () => {
    expect(startedTools([])).toEqual([]);
  });
});
