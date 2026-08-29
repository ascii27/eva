// The tool registry: what Eva is offered, and what happens when she calls it.
//
// Two constraints shape this file, both easy to break later:
//
// 1. The spec list must be STABLE for a whole session. Tool specs sit inside
//    OpenAI's cached prefix, so a list that varied per turn would cost exactly
//    the caching discount history.ts is built around. The kit is built once at
//    bring-up from what is configured — which is also why a tool with no
//    credentials is absent entirely rather than present and failing.
// 2. A tool never throws. Failures come back as an error string in the tool
//    message, so the model can say it couldn't reach something. A throw here
//    would take down a round that was already speaking aloud.

import type { ToolCall, ToolMessage, ToolSpec } from '../openai';
import type { Photo } from '../../vision/photos';
import { BUSY, STARTED } from '../../hermes/errands';
import { formatClock } from './clock';
import { runMemorySearch } from './memory';
import { runSearch } from './search';
import { toolSpecs } from './specs';

/** What the camera tool needs from `useVision`, and nothing more. */
export interface VisionHandles {
  /** iOS camera access, requested before anything is spoken. */
  ensurePermission(): Promise<boolean>;
  /** Mount the viewfinder so the lens warms up during the question. */
  showPreview(): void;
  hidePreview(): void;
  takePhoto(): Promise<{ photo: Photo } | { error: string }>;
}

/** What `ask_other_half` needs from `useErrands`, and nothing more. */
export interface ErrandHandles {
  /**
   * Hand a question to hermes and return AT ONCE — an id, or null when she is
   * already carrying as many as she can. Never awaits: an answer measured at
   * 88.7s must not be inside the round that asked for it.
   */
  start(question: string, needsLookup: boolean): string | null;
}

export interface ToolConfig {
  /** Tavily key, or null when web search is not configured. */
  tavilyKey: string | null;
  /** Camera handles, or null on a build with no camera (Expo Go, simulator). */
  vision: VisionHandles | null;
  /** Errand handles, or null when no hermes gateway is configured. */
  errands: ErrandHandles | null;
}

/** Per-call context: the round's abort signal and its spoken-consent gate. */
export interface ToolRunOptions {
  signal?: AbortSignal;
  /**
   * Ask the room out loud and wait. Absent on transports that cannot run a
   * spoken gate — in which case the camera declines rather than firing, which
   * is the whole guarantee. The wording belongs to the speech layer, so there
   * is nothing to pass in.
   */
  onConsent?: () => Promise<boolean>;
}

/**
 * A tool's answer. `photo` is set only by `camera_look`: an image cannot ride
 * on a `tool` message, so the caller pushes it as a user message afterwards.
 */
export interface ToolResult {
  message: ToolMessage;
  photo?: Photo;
}

export interface ToolKit {
  /** Offered to the model verbatim, unchanged for the life of the session. */
  specs: ToolSpec[];
  run(call: ToolCall, opts?: ToolRunOptions): Promise<ToolResult>;
}

const error = (call: ToolCall, message: string): ToolResult => ({
  message: { role: 'tool', tool_call_id: call.id, content: `Error: ${message}` },
});

const answer = (call: ToolCall, content: string, photo?: Photo): ToolResult => ({
  message: { role: 'tool', tool_call_id: call.id, content },
  ...(photo ? { photo } : {}),
});

/**
 * Arguments as an object. Returns null when the JSON is unusable — which
 * happens for real: `max_tokens` can cut a tool call off mid-arguments, and
 * sse.ts deliberately emits the truncated call rather than dropping it so the
 * round reports a failure instead of waiting on a tool that never ran.
 */
function parseArgs(raw: string): Record<string, unknown> | null {
  const text = raw.trim();
  if (!text) return {}; // the API sends '' for a function that takes none
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function requireQuery(args: Record<string, unknown>): string | null {
  const query = args.query;
  return typeof query === 'string' && query.trim() ? query.trim() : null;
}

/**
 * Take a photo, but only after the room says yes out loud.
 *
 * Every path that is not an audible yes returns without a shutter, and the
 * order of the checks matters: iOS permission is settled *before* anything is
 * spoken, because that dialog is a modal and one appearing over an open
 * microphone would eat the answer to the question we just asked.
 */
async function runCameraLook(
  call: ToolCall,
  vision: VisionHandles | null,
  onConsent: ToolRunOptions['onConsent'],
): Promise<ToolResult> {
  if (!vision) return error(call, 'there is no camera on this device.');
  // No gate available means no way to ask, and unasked is not allowed.
  if (!onConsent) return error(call, 'you cannot ask for permission to use the camera right now, so do not use it.');

  if (!(await vision.ensurePermission())) {
    return error(call, "Michael hasn't allowed camera access on this device.");
  }

  vision.showPreview();
  try {
    const allowed = await onConsent();
    if (!allowed) return answer(call, 'Michael did not agree to the photo. Do not try again unless he brings it up.');

    const shot = await vision.takePhoto();
    if ('error' in shot) return error(call, shot.error);
    return answer(call, 'Photo taken. It is in the next message.', shot.photo);
  } catch (e) {
    // Neither handle is supposed to reject, but this one runs while a round is
    // already speaking aloud — a throw escaping here would take that round down
    // mid-sentence. See the file header: a tool never throws.
    return error(call, `the camera failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    vision.hidePreview();
  }
}

export function buildToolKit({ tavilyKey, vision, errands }: ToolConfig): ToolKit {
  const specs: ToolSpec[] = toolSpecs(tavilyKey, vision !== null, errands !== null);

  return {
    specs,
    async run(call, opts) {
      const args = parseArgs(call.arguments);
      if (!args) return error(call, `could not read the arguments to ${call.name}.`);

      switch (call.name) {
        case 'clock':
          return answer(call, formatClock(new Date()));

        case 'memory_search': {
          const query = requireQuery(args);
          if (!query) return error(call, 'memory_search needs a query.');
          return answer(call, await runMemorySearch(query));
        }

        case 'web_search': {
          if (!tavilyKey) return error(call, 'web search is not configured on this device.');
          const query = requireQuery(args);
          if (!query) return error(call, 'web_search needs a query.');
          return answer(call, await runSearch(tavilyKey, query, opts?.signal));
        }

        case 'camera_look':
          return runCameraLook(call, vision, opts?.onConsent);

        case 'ask_other_half': {
          if (!errands) return error(call, 'you have no way to reach your other half from this device.');
          const question = typeof args.question === 'string' ? args.question.trim() : '';
          if (!question) return error(call, 'ask_other_half needs a question.');
          // Returns immediately — that is the whole design. The round settles
          // at local speed and the answer arrives later through the proactive
          // queue, so there is no gap here for the speaker to cover.
          const id = errands.start(question, args.needs_lookup !== false);
          return answer(call, id ? STARTED : BUSY);
        }

        default:
          return error(call, `no tool named ${call.name}.`);
      }
    },
  };
}
