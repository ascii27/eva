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

/**
 * How long a wait has to last before an aside is worth speaking. The local
 * agent loop answers in well under a second; an opener fired immediately would
 * talk over the reply and delay it. This also fixes the same wart on the Slack
 * path, where the opener fired even when Eva happened to answer quickly.
 */
export const ASIDE_OPENER_DELAY_MS = 1_500;

export interface AsideState {
  /** Round start — the clock the opener's grace period is measured against. */
  startedAt: number;
  lastAsideAt: number;
  pendingTool: string | null;
  lastPhrase: string | null;
  openerSpoken: boolean;
}

/** Never repeats `avoid`; `rand` ∈ [0, 1) keeps the module pure. */
function pickPhrase(pool: string[], avoid: string | null, rand: number): string {
  const options = pool.length > 1 ? pool.filter((p) => p !== avoid) : pool;
  return options[Math.floor(rand * options.length) % options.length];
}

/** Round entry. Speaks nothing: the opener is decideAside's first decision. */
export function beginAside(now: number): AsideState {
  return { startedAt: now, lastAsideAt: now, pendingTool: null, lastPhrase: null, openerSpoken: false };
}

/** A tool echo arrived; the next due aside narrates it instead of a filler. */
export function noteTool(state: AsideState, label: string): AsideState {
  return { ...state, pendingTool: label };
}

/** Called on a coarse tick; returns a line only when one is due. */
export function decideAside(
  now: number,
  state: AsideState,
  rand: number,
): { say: string | null; state: AsideState } {
  if (!state.openerSpoken) {
    if (now - state.startedAt < ASIDE_OPENER_DELAY_MS) return { say: null, state };
    // A tool we already know about is more informative than a generic opener.
    const pool = state.pendingTool !== null ? (TOOL_LINES[state.pendingTool] ?? TOOL_LINES.default) : OPENERS;
    const say = pickPhrase(pool, null, rand);
    return { say, state: { ...state, lastAsideAt: now, pendingTool: null, lastPhrase: say, openerSpoken: true } };
  }
  if (now - state.lastAsideAt < ASIDE_INTERVAL_MS) return { say: null, state };
  const pool = state.pendingTool !== null ? (TOOL_LINES[state.pendingTool] ?? TOOL_LINES.default) : FILLERS;
  const say = pickPhrase(pool, state.lastPhrase, rand);
  return { say, state: { ...state, lastAsideAt: now, pendingTool: null, lastPhrase: say } };
}
