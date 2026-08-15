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
import { formatClock } from './clock';
import { MEMORY_RESULTS, runMemorySearch } from './memory';
import { runSearch } from './search';

export interface ToolConfig {
  /** Tavily key, or null when web search is not configured. */
  tavilyKey: string | null;
}

export interface ToolKit {
  /** Offered to the model verbatim, unchanged for the life of the session. */
  specs: ToolSpec[];
  run(call: ToolCall, signal?: AbortSignal): Promise<ToolMessage>;
}

const CLOCK: ToolSpec = {
  name: 'clock',
  description:
    'The current date and time where Michael is. Use this whenever the answer depends on what day or time it is; you have no other way to know.',
  parameters: { type: 'object', properties: {}, required: [] },
};

const MEMORY_SEARCH: ToolSpec = {
  name: 'memory_search',
  description:
    `Search your notes from earlier conversations with Michael. Your most recent conversations are already summarized above, so use this for older ones — something he mentioned weeks ago, a decision you cannot place, a name you half-remember. Returns up to ${MEMORY_RESULTS} matching conversations.`,
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Distinctive words to look for — names, topics, projects.' },
    },
    required: ['query'],
  },
};

const WEB_SEARCH: ToolSpec = {
  name: 'web_search',
  description:
    'Search the web. Use it for anything current, anything factual you are less than certain about, and anything that may have changed since you were trained — prices, people, events, records, releases, what is happening now. When in doubt, search: a wrong guess said out loud is worse than a search that finds nothing.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query.' },
    },
    required: ['query'],
  },
};

const error = (call: ToolCall, message: string): ToolMessage => ({
  role: 'tool',
  tool_call_id: call.id,
  content: `Error: ${message}`,
});

const answer = (call: ToolCall, content: string): ToolMessage => ({
  role: 'tool',
  tool_call_id: call.id,
  content,
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

export function buildToolKit({ tavilyKey }: ToolConfig): ToolKit {
  const specs: ToolSpec[] = [CLOCK, MEMORY_SEARCH, ...(tavilyKey ? [WEB_SEARCH] : [])];

  return {
    specs,
    async run(call, signal) {
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
          return answer(call, await runSearch(tavilyKey, query, signal));
        }

        default:
          return error(call, `no tool named ${call.name}.`);
      }
    },
  };
}
