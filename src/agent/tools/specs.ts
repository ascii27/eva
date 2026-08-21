// What Eva is told she can do — pure data, and deliberately free of imports
// that touch the filesystem or the network.
//
// Split out of index.ts so the specs can be read without booting the app:
// `npm run probe:tools` loads this file directly under node to check whether a
// question actually provokes a tool call. When these lived next to the
// dispatch, that took a device round-trip to find out.
//
// Wording here is load-bearing and was tuned against the device: an earlier
// draft ("do not use it for things you already know") combined with a similar
// hedge in the persona to talk the model out of searching at all.

import type { ToolSpec } from '../openai';

/** How many conversations one memory search may hand back. More is unlistenable. */
export const MEMORY_RESULTS = 3;

export const CLOCK: ToolSpec = {
  name: 'clock',
  description:
    'The current date and time where Michael is. Use this whenever the answer depends on what day or time it is; you have no other way to know.',
  parameters: { type: 'object', properties: {}, required: [] },
};

export const MEMORY_SEARCH: ToolSpec = {
  name: 'memory_search',
  description: `Search your notes from earlier conversations with Michael. Your most recent conversations are already summarized above, so use this for older ones — something he mentioned weeks ago, a decision you cannot place, a name you half-remember. Returns up to ${MEMORY_RESULTS} matching conversations.`,
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Distinctive words to look for — names, topics, projects.' },
    },
    required: ['query'],
  },
};

export const WEB_SEARCH: ToolSpec = {
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

export const CAMERA_LOOK: ToolSpec = {
  name: 'camera_look',
  description:
    'Take a photo through the camera on Michael\'s desk, which faces him, and look at what it sees. Use it whenever the answer depends on something in front of you — something he is holding up, something on the desk, a page or a screen he is showing you, or how something looks. He is asked out loud before the shutter fires and can say no, so treat it as asking rather than taking. The photo comes back as the next message for you to look at.',
  parameters: {
    type: 'object',
    properties: {
      looking_for: {
        type: 'string',
        description: 'What you are hoping to see, in a few words.',
      },
    },
    required: ['looking_for'],
  },
};

/**
 * The specs offered for a session. Order is fixed and the list is built once —
 * specs sit inside OpenAI's cached prefix, so a list that moved between turns
 * would cost the caching discount history.ts is built around.
 *
 * `camera` is whether the native modules loaded, not whether iOS has granted
 * access. The OS permission is requested on first use precisely so it cannot
 * change this list mid-session.
 */
export function toolSpecs(tavilyKey: string | null, camera = false): ToolSpec[] {
  return [CLOCK, MEMORY_SEARCH, ...(tavilyKey ? [WEB_SEARCH] : []), ...(camera ? [CAMERA_LOOK] : [])];
}
