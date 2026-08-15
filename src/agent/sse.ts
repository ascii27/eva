// Server-sent-event framing for the streaming chat path — no React, no I/O,
// unit-tested.
//
// The reader hands us whatever new text arrived on the socket, which may end
// mid-frame; we return the complete frames and keep the remainder for next
// time. A malformed frame is skipped rather than thrown: by the time one
// arrives, part of the reply is usually already being spoken aloud, and losing
// the rest of it over one bad line would be worse than a missing word.

import type { ChatUsage, ToolCall } from './openai';

/** A tool call being assembled: the API sends it to us a few characters at a time. */
interface PartialCall {
  id: string;
  name: string;
  args: string;
}

export interface SseState {
  /** Text after the last complete line — a frame we have not fully received. */
  buffer: string;
  /**
   * Tool calls under construction, keyed by the `index` the API assigns them.
   * A call is only complete once the stream says it has finished, so these
   * accumulate across frames — and across reads — until then.
   */
  tools: Record<number, PartialCall>;
}

export interface SseChunk {
  deltas: string[];
  usage: ChatUsage | null;
  done: boolean;
  /**
   * Assembled tool calls, populated only on the read that sees the stream
   * finish. Empty on every other read — a half-built call is not a call.
   */
  toolCalls: ToolCall[];
}

export function emptySse(): SseState {
  return { buffer: '', tools: {} };
}

export function parseSse(state: SseState, incoming: string): { state: SseState; chunk: SseChunk } {
  const lines = (state.buffer + incoming).split('\n');
  // The final element is either '' (input ended on a newline) or a partial
  // line; either way it is not yet safe to parse.
  const buffer = lines.pop() ?? '';

  const deltas: string[] = [];
  let usage: ChatUsage | null = null;
  let done = false;
  // Copied rather than mutated in place: parseSse is pure, and its state is
  // threaded through the XHR reader one read at a time.
  const tools: Record<number, PartialCall> = { ...state.tools };
  // Set by any non-null finish_reason, or by [DONE] if the finish frame was
  // lost. Either way it means no more fragments are coming.
  let finished = false;

  for (const raw of lines) {
    const line = raw.trim(); // also strips the \r of a CRLF stream
    if (!line.startsWith('data:')) continue; // blank separators, ': ' comments, 'event:' lines
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') {
      done = true;
      finished = true;
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(payload);
    } catch {
      continue;
    }
    // JSON.parse succeeds on `null`, `42`, and `"text"` — all valid JSON, none of
    // them a frame. Reject them here rather than letting a field access throw:
    // this runs while audio is already playing, so a throw would abandon the
    // rest of a reply mid-sentence.
    if (typeof json !== 'object' || json === null) continue;
    const frame = json as {
      choices?: {
        delta?: { content?: unknown; tool_calls?: unknown };
        finish_reason?: unknown;
      }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
    };
    const choice = frame.choices?.[0];
    const content = choice?.delta?.content;
    if (typeof content === 'string' && content.length > 0) deltas.push(content);
    // Any reason at all — 'tool_calls', 'stop', or a 'length' that cut the
    // arguments off mid-JSON. A truncated call is still emitted so dispatch
    // can report a parse failure the model can apologize for; silently
    // dropping it would leave the round waiting on a tool that never ran.
    if (typeof choice?.finish_reason === 'string') finished = true;
    if (Array.isArray(choice?.delta?.tool_calls)) accumulate(tools, choice.delta.tool_calls);
    if (frame.usage) {
      usage = {
        promptTokens: frame.usage.prompt_tokens ?? 0,
        cachedTokens: frame.usage.prompt_tokens_details?.cached_tokens ?? 0,
        completionTokens: frame.usage.completion_tokens ?? 0,
      };
    }
  }

  // Flushing clears the accumulator, so the finish frame and the [DONE] that
  // follows it don't dispatch the same tool twice.
  const toolCalls = finished ? drain(tools) : [];
  return {
    state: { buffer, tools: finished ? {} : tools },
    chunk: { deltas, usage, done, toolCalls },
  };
}

/**
 * Fold one frame's `tool_calls` array into the accumulator. `index` is the
 * only thing tying fragments together: `id` and `name` arrive on the first
 * fragment for an index, `arguments` a few characters at a time on the rest.
 */
function accumulate(tools: Record<number, PartialCall>, calls: unknown[]): void {
  for (const entry of calls) {
    if (!entry || typeof entry !== 'object') continue;
    const call = entry as { index?: unknown; id?: unknown; function?: { name?: unknown; arguments?: unknown } };
    // Without an index there is nothing to attach the fragment to. Assuming 0
    // would splice a stray fragment into a real call's arguments.
    if (typeof call.index !== 'number') continue;
    const prev = tools[call.index] ?? { id: '', name: '', args: '' };
    tools[call.index] = {
      id: typeof call.id === 'string' && call.id ? call.id : prev.id,
      name: typeof call.function?.name === 'string' && call.function.name ? call.function.name : prev.name,
      args: prev.args + (typeof call.function?.arguments === 'string' ? call.function.arguments : ''),
    };
  }
}

/** Accumulator to finished calls, in the index order the API assigned. */
function drain(tools: Record<number, PartialCall>): ToolCall[] {
  return Object.keys(tools)
    .map(Number)
    .sort((a, b) => a - b)
    .map((i) => ({ id: tools[i].id, name: tools[i].name, arguments: tools[i].args }));
}
