// Pure aside policy for the thinking wait — no React. useEcho drives this on
// a coarse interval during an ask round; all timing decisions live here so
// cadence, tool priority, and phrase variety are unit-testable.

export const ASIDE_INTERVAL_MS = 12_000;

export const OPENERS = [
  'Let me see...',
  'Hmm, give me a moment...',
  'Okay, let me think...',
  'Good question — one sec...',
];

export const FILLERS = [
  'Hmmm...',
  'Still working on it...',
  'One moment...',
  'Bear with me...',
  'Almost there...',
];

// Keyed by the tool label extracted from Eva's tool-echo messages
// (toolLabelFromEcho in slack/sanitize.ts); 'default' covers unknown labels.
export const TOOL_LINES: Record<string, string[]> = {
  terminal: ["I'm running a quick check...", 'Let me run something...'],
  skill_view: ["I'm looking that up...", 'Let me check my notes...'],
  web_search: ["I'm searching for that...", 'Let me search around...'],
  default: ["I'm investigating...", "I'm digging into it..."],
};

export interface AsideState {
  lastAsideAt: number;
  pendingTool: string | null;
  lastPhrase: string | null;
}

/** Never repeats `avoid`; `rand` ∈ [0, 1) keeps the module pure. */
function pickPhrase(pool: string[], avoid: string | null, rand: number): string {
  const options = pool.length > 1 ? pool.filter((p) => p !== avoid) : pool;
  return options[Math.floor(rand * options.length) % options.length];
}

/** Round entry: speak an opener immediately and seed the cadence clock. */
export function openAside(now: number, rand: number): { say: string; state: AsideState } {
  const say = pickPhrase(OPENERS, null, rand);
  return { say, state: { lastAsideAt: now, pendingTool: null, lastPhrase: say } };
}

/** A tool echo arrived; the next due aside narrates it instead of a filler. */
export function noteTool(state: AsideState, label: string): AsideState {
  return { ...state, pendingTool: label };
}

/** Called on a coarse tick; returns a line only when the cadence is due. */
export function decideAside(
  now: number,
  state: AsideState,
  rand: number,
): { say: string | null; state: AsideState } {
  if (now - state.lastAsideAt < ASIDE_INTERVAL_MS) return { say: null, state };
  const pool = state.pendingTool !== null ? (TOOL_LINES[state.pendingTool] ?? TOOL_LINES.default) : FILLERS;
  const say = pickPhrase(pool, state.lastPhrase, rand);
  return { say, state: { lastAsideAt: now, pendingTool: null, lastPhrase: say } };
}
