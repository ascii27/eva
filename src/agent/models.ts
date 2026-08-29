// Which models Eva can talk to — pure data, no storage, no React.
//
// Split from config.ts so scripts/ can import it: config.ts pulls in
// AsyncStorage, which node cannot load, and probe-tools.ts previously carried
// its own copy of the default. That copy went stale the moment the default
// changed, and the probe silently kept measuring the old model.

/**
 * Chosen for behaviour, not only for price. Measured with `npm run probe:tools`
 * over six questions: gpt-5.4-mini called the right tool 6/6 and emitted the
 * spoken preamble 6/6, where gpt-4o-mini managed 5/6 and 0/6. The preamble is
 * what Eva says while a tool runs, so on a model that never emits one she goes
 * silent mid-round and the canned TOOL_LINES have to cover it.
 *
 * It is also faster to first audio (561ms against 914ms), and spends no
 * reasoning tokens while function tools are attached, so MAX_REPLY_TOKENS
 * still buys a whole reply.
 */
export const DEFAULT_MODEL = 'gpt-5.4-mini';

/**
 * What the overlay's Model button cycles through. Deliberately short — it is a
 * cycle, not a list, so every extra entry is another tap. gpt-4o-mini earns its
 * place by being the one that does *not* emit preambles: it is how you check
 * that behaviour is the model's and not ours.
 */
export const MODEL_PRESETS = ['gpt-5.4-mini', 'gpt-5.4', 'gpt-4o-mini', 'o4-mini'] as const;

/**
 * Vision, measured with `npm run probe:vision`. All four accept image input —
 * o4-mini included, which was the one in doubt — so switching models mid-session
 * never turns the camera into an error.
 *
 * What does differ is the consent preamble, and it matters more here than for
 * any other tool: that sentence is the question the microphone opens for.
 * Over three room-shaped questions ("what am I holding", …):
 *
 *   gpt-5.4-mini  3/3 called camera_look, 3/3 phrased it as a question
 *   gpt-5.4       2/3 called it,          2/2 phrased it as a question
 *   gpt-4o-mini   0/3 called it — it asks "mind if I take a look?" and then
 *                 never reaches for the tool, so nothing happens
 *   o4-mini       3/3 called it,          0/3 said anything at all
 *
 * o4-mini is why the gate speaks CONSENT_QUESTION itself when no preamble
 * arrives: without that branch it opens the mic in silence and waits for
 * someone to agree to a question they never heard.
 */

/**
 * The realtime brain's model, measured with `npm run probe:realtime`.
 *
 * Phase 1 moves the local brain onto a Realtime API session in text mode, and
 * the whole justification is time-to-first-token: nothing is spoken until the
 * first delta arrives. Over five tool-provoking questions, on an already-open
 * socket (the real condition — the device dials at wake, seconds before anyone
 * has finished talking) against chat completions paying setup per turn:
 *
 *   what time is it                  realtime 408ms   chat 1982ms
 *   what day is it today             realtime 526ms   chat 1461ms
 *   who won the last super bowl      realtime 470ms   chat  512ms
 *   weather in san francisco         realtime 393ms   chat 1024ms
 *   what did we talk about yesterday realtime 563ms   chat  910ms
 *
 * The chat column is measured with persona and question only — no history —
 * so it flatters the transport being replaced, which on the device re-uploads
 * the whole conversation on every lap.
 *
 * The preamble rate is 5/5: every tool round said something first. That is the
 * sentence the speaker plays across a tool gap and the question the consent
 * microphone opens for, so a model that skipped it would push the round onto
 * the canned TOOL_LINES and leave the camera gate speaking for itself.
 */
export const DEFAULT_REALTIME_MODEL = 'gpt-realtime-2.1-mini';

/**
 * What the overlay's Model button cycles through on the realtime brain. Kept
 * to the minis: text-mode realtime is chosen for latency and costs less per
 * token than gpt-5.4-mini ($0.60/$2.40 against $0.75/$4.50 per 1M), and the
 * full-size realtime models spend that saving without buying speed.
 */
export const REALTIME_MODEL_PRESETS = ['gpt-realtime-2.1-mini', 'gpt-realtime-mini'] as const;
