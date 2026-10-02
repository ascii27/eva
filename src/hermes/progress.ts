// Reading hermes-agent's named stream events — pure, no I/O, unit-tested.
//
// The API server is OpenAI-compatible except for one addition: it narrates its
// server-side tool runs as `event: hermes.tool.progress` frames alongside the
// chat stream. sse.ts does the framing and hands them over as raw payloads;
// deciding what they mean is this file's job.
//
// It matters because of what was measured. On a hermes round the model streams
// nothing before a tool runs — no preamble, unlike the chat brain, where the
// model's own "let me look that up" is what covers the gap. A lookup turn was
// 8.8s and a memory turn 16.3s of pure silence. These frames are the only
// warning the round gets, so they are what arms the TOOL_LINES fallback and
// speech.hold(). See scripts/probe-hermes-brain.ts for the measurements.

import type { SseEvent } from '../agent/sse';

/** The one event name the API server emits on the chat-completions stream. */
const TOOL_PROGRESS = 'hermes.tool.progress';

/**
 * Names of tools that *started* in this read, in arrival order and each once.
 *
 * Only `running` counts. A `completed` frame means the reply is about to
 * resume, which the next content delta says better — and treating it as a
 * start would re-arm the hold after the answer had begun.
 *
 * Never throws: by the time a malformed frame arrives the preamble is usually
 * already being spoken aloud, and dropping the round over one bad line is worse
 * than missing a tool line. Same rule as the tools themselves.
 */
export function startedTools(events: SseEvent[]): string[] {
  const names: string[] = [];
  for (const event of events) {
    if (event.name !== TOOL_PROGRESS) continue;
    let payload: unknown;
    try {
      payload = JSON.parse(event.data);
    } catch {
      continue;
    }
    if (typeof payload !== 'object' || payload === null) continue;
    const { tool, status } = payload as { tool?: unknown; status?: unknown };
    if (status !== 'running') continue;
    if (typeof tool !== 'string' || !tool) continue;
    if (!names.includes(tool)) names.push(tool);
  }
  return names;
}
