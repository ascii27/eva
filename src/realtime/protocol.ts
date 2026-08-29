// The Realtime API wire format — encode what we send, decode what we act on.
//
// Pure: no React, no storage, no sockets, so `node scripts/probe-realtime.ts`
// can load it (the constraint commit e0c64b0 established for bundle.ts). The
// socket owns the connection, this file owns the shapes.
//
// Everything here is the GA interface, not the beta one, and the difference is
// not cosmetic — beta's `modalities` became `output_modalities`, and beta's
// `response.text.delta` became `response.output_text.delta`. A beta spelling
// does not error, it simply never fires, so a decoder written from beta-era
// examples yields a session that connects, accepts a question, and stays
// silent forever. Measured against the live API by probe:realtime, whose
// "server events seen" list is the authority for what arrives.

import type { ChatUsage, ToolCall, ToolSpec } from '../agent/openai';
import type { ChatMessage } from '../agent/history';

/** Text in, text out. No audio on the wire — STT and Kokoro stay on-device. */
export const OUTPUT_MODALITIES = ['text'] as const;

/** Matches MAX_REPLY_TOKENS on the chat path: a reply read aloud in a room. */
export const MAX_RESPONSE_TOKENS = 300;

// ---------------------------------------------------------------- outgoing

/** A client event, ready to be JSON-stringified onto the socket. */
export type ClientEvent = Record<string, unknown>;

/**
 * Tool specs in the realtime shape. Chat completions nests these under a
 * `function` key; realtime is flat, and a nested spec is rejected outright.
 */
export function realtimeTools(specs: ToolSpec[]): ClientEvent[] {
  return specs.map((s) => ({
    type: 'function',
    name: s.name,
    description: s.description,
    parameters: s.parameters,
  }));
}

export interface SessionConfig {
  instructions: string;
  specs: ToolSpec[];
  maxTokens?: number;
}

/**
 * The one-shot session configuration, sent immediately after `session.created`.
 *
 * Turn detection is nulled explicitly. It configures voice-activity detection
 * over an audio input this session never opens, and its default would let the
 * server decide on its own when a turn had ended — responses we never asked
 * for. Nulling it makes `response.create` the only thing that starts a reply.
 */
export function sessionUpdate(cfg: SessionConfig): ClientEvent {
  return {
    type: 'session.update',
    session: {
      type: 'realtime',
      output_modalities: OUTPUT_MODALITIES,
      instructions: cfg.instructions,
      max_output_tokens: cfg.maxTokens ?? MAX_RESPONSE_TOKENS,
      audio: { input: { turn_detection: null } },
      tools: realtimeTools(cfg.specs),
      tool_choice: 'auto',
    },
  };
}

export function userText(text: string): ClientEvent {
  return {
    type: 'conversation.item.create',
    item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
  };
}

export function systemText(text: string): ClientEvent {
  return {
    type: 'conversation.item.create',
    item: { type: 'message', role: 'system', content: [{ type: 'input_text', text }] },
  };
}

/** A turn Eva already spoke, replayed into a fresh socket. */
export function assistantText(text: string): ClientEvent {
  return {
    type: 'conversation.item.create',
    item: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] },
  };
}

/**
 * A photo, as a data URL. Rides on a user item of its own because an image
 * cannot travel on a tool result — the same constraint as the chat path.
 *
 * `id` is ours to choose: the server accepts a client-supplied item id and
 * echoes it back (verified against the live API). Naming the item at creation
 * is what makes `deleteItem` possible later without having to watch the item
 * lifecycle events to learn what the photo was called.
 */
export function userImage(dataUrl: string, caption?: string, id?: string): ClientEvent {
  const content: ClientEvent[] = [{ type: 'input_image', image_url: dataUrl, detail: 'auto' }];
  if (caption) content.unshift({ type: 'input_text', text: caption });
  return {
    type: 'conversation.item.create',
    item: { ...(id ? { id } : {}), type: 'message', role: 'user', content },
  };
}

/** Item ids are ours to pick; this keeps them recognisable in a wire log. */
export function photoItemId(n: number): string {
  return `evaphoto${String(n).padStart(16, '0')}`;
}

export function functionOutput(callId: string, output: string): ClientEvent {
  return {
    type: 'conversation.item.create',
    item: { type: 'function_call_output', call_id: callId, output },
  };
}

/**
 * Drop an item from the server-side conversation. Used on photos once a round
 * settles: an image item is re-billed on every later response in the session,
 * where the chat path's vision window ages a photo out to prose after two
 * turns. Without this the socket quietly keeps paying for a picture nobody
 * can refer to any more.
 */
export function deleteItem(itemId: string): ClientEvent {
  return { type: 'conversation.item.delete', item_id: itemId };
}

export interface ResponseOptions {
  /** `'none'` forces an answer with no tools — the tool loop's last lap. */
  toolChoice?: 'auto' | 'none';
  maxTokens?: number;
}

/**
 * Ask for a reply.
 *
 * The overrides here are per-response, which is what lets the last lap refuse
 * tools without touching session config. The chat path has to drop the specs
 * from the request instead and knowingly forfeits its cached prefix for that
 * lap; here the session never moves, so nothing is invalidated.
 */
export function responseCreate(opts: ResponseOptions = {}): ClientEvent {
  return {
    type: 'response.create',
    response: {
      output_modalities: OUTPUT_MODALITIES,
      max_output_tokens: opts.maxTokens ?? MAX_RESPONSE_TOKENS,
      ...(opts.toolChoice ? { tool_choice: opts.toolChoice } : {}),
    },
  };
}

export function responseCancel(): ClientEvent {
  return { type: 'response.cancel' };
}

// ---------------------------------------------------------------- incoming

/**
 * What the socket layer above actually acts on. Everything else on the wire —
 * item lifecycle, content parts, argument deltas, rate limits — is real and
 * useful for debugging, but nothing branches on it, so it collapses to
 * `other` rather than growing a case that would never be read.
 */
export type ServerEvent =
  | { kind: 'ready' }
  | { kind: 'configured' }
  | { kind: 'delta'; responseId: string; itemId: string; text: string }
  | { kind: 'tool-call'; responseId: string; itemId: string; call: ToolCall }
  | { kind: 'done'; responseId: string; status: string; usage: ChatUsage | null }
  | { kind: 'error'; message: string }
  | { kind: 'other'; type: string };

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function usageOf(raw: unknown): ChatUsage | null {
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as Record<string, unknown>;
  const details = (u.input_token_details ?? {}) as Record<string, unknown>;
  return {
    promptTokens: typeof u.input_tokens === 'number' ? u.input_tokens : 0,
    cachedTokens: typeof details.cached_tokens === 'number' ? details.cached_tokens : 0,
    completionTokens: typeof u.output_tokens === 'number' ? u.output_tokens : 0,
  };
}

/**
 * Decode one frame. Returns null only for something that is not an event at
 * all — malformed JSON, or a JSON value that is legal but not an object
 * (`null`, a bare number), which the chat path's SSE reader also guards
 * against. An unrecognised event is `other`, never null: silence about an
 * event we do not handle is the failure mode this whole file exists to avoid.
 */
export function decode(raw: string): ServerEvent | null {
  let ev: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    ev = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const type = str(ev.type);
  switch (type) {
    case 'session.created':
      return { kind: 'ready' };
    case 'session.updated':
      return { kind: 'configured' };
    case 'response.output_text.delta':
      return {
        kind: 'delta',
        responseId: str(ev.response_id),
        itemId: str(ev.item_id),
        text: str(ev.delta),
      };
    case 'response.function_call_arguments.done':
      // Arguments arrive as deltas too, but there is nothing to do with half a
      // JSON object, so only the assembled form is surfaced. Note this fires
      // on cancelled and incomplete responses as well — the round that owns
      // the response has to decide whether the call is still wanted.
      return {
        kind: 'tool-call',
        responseId: str(ev.response_id),
        itemId: str(ev.item_id),
        call: { id: str(ev.call_id), name: str(ev.name), arguments: str(ev.arguments) },
      };
    case 'response.done': {
      const res = (ev.response ?? {}) as Record<string, unknown>;
      return {
        kind: 'done',
        responseId: str(res.id),
        status: str(res.status),
        usage: usageOf(res.usage),
      };
    }
    case 'error': {
      const err = (ev.error ?? {}) as Record<string, unknown>;
      return { kind: 'error', message: str(err.message) || 'realtime error' };
    }
    default:
      return { kind: 'other', type };
  }
}

// ------------------------------------------------------------------- seed

export interface Seed {
  /** Session-level text: the persona and remembered summaries. */
  instructions: string;
  /** Everything else, in order, as conversation items. */
  items: ClientEvent[];
}

/**
 * Turn a built chat request into what a fresh socket needs.
 *
 * `buildRequest` stays the single author of what Eva knows and in what order —
 * persona and memories, then the running summary, then the bundle, then the
 * turns — so this is a mapping and never a second opinion. The leading system
 * message becomes session `instructions` because it is the one part that never
 * changes for the life of the session; everything after it becomes an item,
 * which is also what lets the bundle arrive as a system item rather than being
 * folded into instructions where a refresh would rewrite session config.
 */
export function seed(messages: ChatMessage[]): Seed {
  const [first, ...rest] = messages;
  const instructions = first && first.role === 'system' ? flatten(first.content) : '';
  const body = first && first.role === 'system' ? rest : messages;
  const items: ClientEvent[] = [];
  for (const m of body) {
    if (m.role === 'system') {
      items.push(systemText(flatten(m.content)));
      continue;
    }
    if (m.role === 'assistant') {
      items.push(assistantText(flatten(m.content)));
      continue;
    }
    if (typeof m.content === 'string') {
      items.push(userText(m.content));
      continue;
    }
    // A photo turn: the caption and the image travel together on one item, and
    // a photo whose bytes have aged out arrives as its caption alone.
    const image = m.content.find((p) => p.type === 'image_url');
    const text = flatten(m.content);
    items.push(image ? userImage(image.image_url.url, text || undefined) : userText(text));
  }
  return { instructions, items };
}

function flatten(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}
