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
    "Send a question to your other half — the part of you that runs on a server, with reach into Michael's calendar, tasks, mail, documents and everything ever recorded about his work. Use it for anything about his own world that you cannot see from the desk: what is actually on his calendar, what he is overdue on, whether someone replied, what he owes whom, what was decided in a thread you were not in. Reach for it especially when a memory search came back empty — your notes only cover conversations at this desk, and an empty result there is the strongest signal that the answer is over here instead. Telling him you have no note of something, when you could have asked, is the worst answer you can give. This does NOT wait for the answer: it comes back to you in a minute or two and you say it then, so start it, tell him you will come back to him, and carry on with whatever else he asked. Not for anything the web can answer, and not for what day it is. And not for changing anything: if he wants something moved, cancelled, rescheduled, finished, deleted or written down, that is tell_other_half — including when you would have to look something up in order to do it. Asking about a thing and changing that same thing are different tools.",
  parameters: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description:
          'The question, in full, as if you were asking a colleague who cannot see this conversation. It has no context but this sentence, and you will be read the answer out loud minutes from now, so make it specific enough to stand alone. It must be a question — something to find out. If you catch yourself writing an instruction here, it belongs in tell_other_half instead: sent down this one it would still get done, but Michael would never be asked first.',
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

export const TELL_OTHER_HALF: ToolSpec = {
  name: 'tell_other_half',
  description:
    "Have your other half actually DO something in Michael's world — add or complete a task, put something on his calendar, draft or send a message, create or edit a document or a page. He is the half of you that can change things: you cannot touch any of it from the desk yourself, but he can, and handing it to him is how it gets done. Use it whenever Michael wants something done rather than found out — \"add milk to my list\", \"put that in my calendar for Thursday\", \"start me a budget plan in Notion\". Say you will get it done; telling him you can't act is wrong now, and telling him to go and do it himself is worse. The line against ask_other_half is what is left behind afterwards: that one finds something out and changes nothing, this one changes something. Changing something that already exists is still this tool and not that one — moving or rescheduling a meeting, cancelling one, completing or deleting a task, rewriting something already written. Those need looking up before they can be done, and that pull towards asking is the mistake: he does the looking up himself as part of doing it. This does NOT wait — he works on it over the next minute or two and reports back to you then, so hand it over, say you have passed it on, and carry on with the conversation. Never tell Michael it is done until that report comes back.",
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description:
          'What you want done, in full, written as an instruction to a colleague who cannot see this conversation and has no context but this sentence. Say exactly what should change and where, and include everything he would need to do it without asking: the wording of the task, the day and time, which list or calendar or page. He cannot come back to you with a question.',
      },
      changes_existing: {
        type: 'boolean',
        description:
          'True when this edits, moves, reschedules, renames, completes, cancels or deletes something that is already there. False when it only creates something new and leaves everything else as it was. Adding a task or making a new page is false; rescheduling or cancelling a meeting, completing or deleting a task, and rewriting something already written are all true. True means Michael is asked out loud to confirm before anything is sent, so get it right — an unnecessary question costs him a breath, a missing one costs him a meeting.',
      },
    },
    required: ['action', 'changes_existing'],
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
 * `otherHalf` is whether a hermes gateway is configured, and it gates both the
 * asking and the telling — they are one gateway. Absent rather than
 * present-and-failing, the same rule as web search without a Tavily key: Eva
 * knowing she has no way to ask beats her promising to and then apologising.
 */
export function toolSpecs(tavilyKey: string | null, camera = false, otherHalf = false): ToolSpec[] {
  return [
    CLOCK,
    MEMORY_SEARCH,
    ...(tavilyKey ? [WEB_SEARCH] : []),
    ...(camera ? [CAMERA_LOOK] : []),
    ...(otherHalf ? [ASK_OTHER_HALF, TELL_OTHER_HALF] : []),
  ];
}
