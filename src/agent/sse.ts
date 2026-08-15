// Server-sent-event framing for the streaming chat path — no React, no I/O,
// unit-tested.
//
// The reader hands us whatever new text arrived on the socket, which may end
// mid-frame; we return the complete frames and keep the remainder for next
// time. A malformed frame is skipped rather than thrown: by the time one
// arrives, part of the reply is usually already being spoken aloud, and losing
// the rest of it over one bad line would be worse than a missing word.

import type { ChatUsage } from './openai';

export interface SseState {
  /** Text after the last complete line — a frame we have not fully received. */
  buffer: string;
}

export interface SseChunk {
  deltas: string[];
  usage: ChatUsage | null;
  done: boolean;
}

export function emptySse(): SseState {
  return { buffer: '' };
}

export function parseSse(state: SseState, incoming: string): { state: SseState; chunk: SseChunk } {
  const lines = (state.buffer + incoming).split('\n');
  // The final element is either '' (input ended on a newline) or a partial
  // line; either way it is not yet safe to parse.
  const buffer = lines.pop() ?? '';

  const deltas: string[] = [];
  let usage: ChatUsage | null = null;
  let done = false;

  for (const raw of lines) {
    const line = raw.trim(); // also strips the \r of a CRLF stream
    if (!line.startsWith('data:')) continue; // blank separators, ': ' comments, 'event:' lines
    const payload = line.slice(5).trim();
    if (payload === '[DONE]') {
      done = true;
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
      choices?: { delta?: { content?: unknown } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
    };
    const content = frame.choices?.[0]?.delta?.content;
    if (typeof content === 'string' && content.length > 0) deltas.push(content);
    if (frame.usage) {
      usage = {
        promptTokens: frame.usage.prompt_tokens ?? 0,
        cachedTokens: frame.usage.prompt_tokens_details?.cached_tokens ?? 0,
        completionTokens: frame.usage.completion_tokens ?? 0,
      };
    }
  }

  return { state: { buffer }, chunk: { deltas, usage, done } };
}
