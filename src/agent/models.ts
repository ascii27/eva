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
