// OpenAI chat completions calls the device makes directly — no SDK, just fetch,
// in the same shape as src/slack/api.ts.

import type { ChatMessage } from './history';
import { emptySse, parseSse } from './sse';

const BASE = 'https://api.openai.com/v1';

export interface ChatUsage {
  promptTokens: number;
  /** Prefix tokens served from OpenAI's automatic cache, at a discount. */
  cachedTokens: number;
  completionTokens: number;
}

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string, as the API returns it. */
  arguments: string;
}

/** An assistant message as it goes back into the next request of a tool loop. */
export interface AssistantMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
}

/** A tool's result, answering one tool_call by id. */
export interface ToolMessage {
  role: 'tool';
  tool_call_id: string;
  content: string;
}

/** Anything that can appear in a request: plain turns plus the tool-loop shapes. */
export type RequestMessage = ChatMessage | AssistantMessage | ToolMessage;

export interface ChatReply {
  text: string;
  toolCalls: ToolCall[];
  usage: ChatUsage | null;
  /** Echo it back verbatim when continuing a tool loop. */
  message: AssistantMessage;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatOptions {
  apiKey: string;
  model: string;
  messages: RequestMessage[];
  /** Omitted from the request when empty — the API rejects `tools: []`. */
  tools?: ToolSpec[];
  signal?: AbortSignal;
  maxTokens?: number;
  temperature?: number;
}

interface RawChoice {
  message?: { content?: string | null; tool_calls?: AssistantMessage['tool_calls'] };
}

interface RawResponse {
  choices?: RawChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  error?: { message?: string };
}

export async function chat({
  apiKey,
  model,
  messages,
  tools,
  signal,
  maxTokens,
  temperature,
}: ChatOptions): Promise<ChatReply> {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    signal,
    body: JSON.stringify({
      model,
      messages,
      ...(tools && tools.length
        ? { tools: tools.map((t) => ({ type: 'function', function: t })) }
        : {}),
      ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
    }),
  });

  // Read the body either way: OpenAI puts the useful reason in error.message,
  // and "http 429" alone doesn't tell you whether it was rate or quota.
  const data = (await res.json().catch(() => null)) as RawResponse | null;
  if (!res.ok) {
    throw new Error(data?.error?.message ? `${data.error.message} (http ${res.status})` : `http ${res.status}`);
  }
  if (!data) throw new Error('unreadable response');

  const message = data.choices?.[0]?.message;
  if (!message) throw new Error('no choices in response');

  return {
    text: (message.content ?? '').trim(),
    toolCalls: (message.tool_calls ?? []).map((c) => ({
      id: c.id,
      name: c.function.name,
      arguments: c.function.arguments,
    })),
    usage: data.usage
      ? {
          promptTokens: data.usage.prompt_tokens ?? 0,
          cachedTokens: data.usage.prompt_tokens_details?.cached_tokens ?? 0,
          completionTokens: data.usage.completion_tokens ?? 0,
        }
      : null,
    message: { role: 'assistant', content: message.content ?? null, tool_calls: message.tool_calls },
  };
}

/**
 * Transcript line for a round's token spend, e.g. `412 in (256 cached) · 89 out`.
 * Surfacing the cached count is the only way to see whether the request layout
 * in history.ts is actually earning the caching discount.
 */
export function formatUsage(usage: ChatUsage): string {
  const cached = usage.cachedTokens > 0 ? ` (${usage.cachedTokens} cached)` : '';
  return `${usage.promptTokens} in${cached} · ${usage.completionTokens} out`;
}

export interface ChatStreamOptions extends ChatOptions {
  /** Called with each content delta as it arrives, in order. */
  onDelta: (text: string) => void;
}

/**
 * Streaming counterpart to `chat`, on XMLHttpRequest rather than fetch —
 * React Native's fetch cannot stream a response body.
 *
 * Tool calls are NOT supported here: their arguments arrive fragmented across
 * frames and would need reassembly. `toolCalls` is always empty, and the caller
 * is responsible for using non-streaming `chat` whenever tools are offered
 * (see the guard in useAgent).
 */
export function chatStream({
  apiKey,
  model,
  messages,
  signal,
  maxTokens,
  temperature,
  onDelta,
}: ChatStreamOptions): Promise<ChatReply> {
  return new Promise<ChatReply>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let sse = emptySse();
    let consumed = 0;
    let text = '';
    let usage: ChatUsage | null = null;
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    // responseText accumulates, so only ever read the new tail.
    const read = () => {
      const whole = xhr.responseText;
      if (whole.length <= consumed) return;
      const incoming = whole.slice(consumed);
      consumed = whole.length;
      const r = parseSse(sse, incoming);
      sse = r.state;
      if (r.chunk.usage) usage = r.chunk.usage;
      for (const delta of r.chunk.deltas) {
        text += delta;
        onDelta(delta);
      }
    };

    // fetch() checks signal.aborted synchronously; XHR has no equivalent, and an
    // already-fired 'abort' event will never fire again. Without this an aborted
    // caller still gets a live request and stray onDelta calls.
    if (signal?.aborted) {
      finish(() => reject(new Error('aborted')));
      return;
    }

    const onAbort = () => xhr.abort();
    signal?.addEventListener('abort', onAbort);
    const cleanup = () => signal?.removeEventListener('abort', onAbort);

    xhr.open('POST', `${BASE}/chat/completions`);
    xhr.setRequestHeader('Authorization', `Bearer ${apiKey}`);
    xhr.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
    xhr.setRequestHeader('Accept', 'text/event-stream');

    // MUST be assigned before send(): RN decides whether to deliver the body
    // incrementally by checking whether onprogress is already set. Assign it
    // afterwards and the whole response arrives in one lump.
    xhr.onprogress = read;
    xhr.onload = () => {
      read();
      cleanup();
      if (xhr.status < 200 || xhr.status >= 300) {
        finish(() => reject(new Error(streamErrorMessage(xhr.responseText, xhr.status))));
        return;
      }
      finish(() =>
        resolve({
          text: text.trim(),
          toolCalls: [],
          usage,
          message: { role: 'assistant', content: text },
        }),
      );
    };
    xhr.onerror = () => {
      cleanup();
      finish(() => reject(new Error('network error')));
    };
    xhr.onabort = () => {
      cleanup();
      finish(() => reject(new Error('aborted')));
    };

    xhr.send(
      JSON.stringify({
        model,
        messages,
        stream: true,
        // Without this a streamed response carries no usage at all, and the
        // per-round token line silently goes blank.
        stream_options: { include_usage: true },
        ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
      }),
    );
  });
}

/** An error body on the streaming path is ordinary JSON, not an SSE frame. */
function streamErrorMessage(body: string, status: number): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    if (parsed?.error?.message) return `${parsed.error.message} (http ${status})`;
  } catch {
    // fall through to the bare status
  }
  return `http ${status}`;
}
