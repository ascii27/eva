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
  description: `Search your notes from earlier conversations with Michael. Your most recent conversations are already summarized above, so use this for older ones — something he mentioned weeks ago, a decision you cannot place, a name you half-remember. Returns up to ${MEMORY_RESULTS} matching conversations. These are only the conversations you and he have had at this desk: nothing that happened in his mail, in a thread you were not in, on his calendar, or in his task list is in here, and finding nothing here does not mean there is nothing to find. When it comes back empty and the answer would live somewhere he actually works, ask your other half rather than telling him you have no note of it.`,
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

export const ASK_OTHER_HALF: ToolSpec = {
  name: 'ask_other_half',
  description:
    "Send a question to your other half — the part of you that runs on a server, with reach into Michael's calendar, tasks, mail, documents and everything ever recorded about his work. Use it for anything about his own world that you cannot see from the desk: what is actually on his calendar, what he is overdue on, whether someone replied, what he owes whom, what was decided in a thread you were not in. Reach for it especially when a memory search came back empty — your notes only cover conversations at this desk, and an empty result there is the strongest signal that the answer is over here instead. Telling him you have no note of something, when you could have asked, is the worst answer you can give. This does NOT wait for the answer: it comes back to you in a minute or two and you say it then, so start it, tell him you will come back to him, and carry on with whatever else he asked. Not for anything the web can answer, and not for what day it is.",
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description:
          'The question, in full, as if you were asking a colleague who cannot see this conversation. It has no context but this sentence, and you will be read the answer out loud minutes from now, so make it specific enough to stand alone.',
      },
      needs_lookup: {
        type: 'boolean',
        description:
          'True when answering means actually going and looking — the calendar, the task list, mail, a document. False when it is something to recall or reason about. False is much faster, so do not ask for a lookup you do not need.',
      },
    },
    required: ['question', 'needs_lookup'],
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
 *
 * `otherHalf` is whether a hermes gateway is configured. Absent rather than
 * present-and-failing, the same rule as web search without a Tavily key: Eva
 * knowing she has no way to ask beats her promising to and then apologising.
 */
export function toolSpecs(tavilyKey: string | null, camera = false, otherHalf = false): ToolSpec[] {
  return [
    CLOCK,
    MEMORY_SEARCH,
    ...(tavilyKey ? [WEB_SEARCH] : []),
    ...(camera ? [CAMERA_LOOK] : []),
    ...(otherHalf ? [ASK_OTHER_HALF] : []),
  ];
}
