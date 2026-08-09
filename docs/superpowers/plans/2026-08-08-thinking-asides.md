# Thinking Asides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the 10–90s wait while Eva thinks with short spoken asides — an opener, periodic fillers, and tool-aware narration — so the pause feels purposeful.

**Architecture:** A pure decision module (`src/speech/asides.ts`, mirrors `conversation.ts`) owns phrase pools and cadence; `useEcho` drives it with an interval during the ask round and speaks results through the existing TTS facade; `useSlack` surfaces a per-tool-echo callback from the spot that currently discards tool noise.

**Tech Stack:** React Native + Expo, TypeScript 6, Jest (`@jest/globals` imports — TS6 does not auto-include @types globals).

**Spec:** `docs/superpowers/specs/2026-08-08-thinking-asides-design.md`

## Global Constraints

- Pure modules (`asides.ts`, `sanitize.ts`) must have **no React imports** and no side effects; randomness is caller-passed.
- Tests import from `@jest/globals` (e.g. `import { describe, expect, it } from '@jest/globals';`).
- The aside path must **never touch `convWindow` or `voiceRound`** in `useEcho` — asides are cosmetic and must not affect round outcomes or the follow-up window.
- `ASIDE_INTERVAL_MS = 12_000`. Dev toggle default: **on** (stored `'0'` disables, matching the conversation toggle pattern).
- Every epoch bump in `useEcho` must also clear aside state (openMic, askEva entry, cancel, unmount).
- Verification commands: `npx jest <file>` for one suite, `npm test` for all, `npx tsc --noEmit` for types.
- Commit messages: end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Pure asides module

**Files:**
- Create: `src/speech/asides.ts`
- Test: `src/speech/__tests__/asides.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces (used by Task 4):
  - `ASIDE_INTERVAL_MS: number` (12_000)
  - `interface AsideState { lastAsideAt: number; pendingTool: string | null; lastPhrase: string | null }`
  - `openAside(now: number, rand: number): { say: string; state: AsideState }`
  - `noteTool(state: AsideState, label: string): AsideState`
  - `decideAside(now: number, state: AsideState, rand: number): { say: string | null; state: AsideState }`
  - Exported pools for test assertions: `OPENERS: string[]`, `FILLERS: string[]`, `TOOL_LINES: Record<string, string[]>`

- [ ] **Step 1: Write the failing test**

Create `src/speech/__tests__/asides.test.ts`:

```typescript
import { describe, expect, it } from '@jest/globals';
import {
  ASIDE_INTERVAL_MS,
  decideAside,
  FILLERS,
  noteTool,
  openAside,
  OPENERS,
  TOOL_LINES,
} from '../asides';

const NOW = 1_754_600_000_000;

describe('openAside', () => {
  it('returns an opener and seeds the state', () => {
    const { say, state } = openAside(NOW, 0);
    expect(OPENERS).toContain(say);
    expect(state).toEqual({ lastAsideAt: NOW, pendingTool: null, lastPhrase: say });
  });

  it('is deterministic for a given rand', () => {
    expect(openAside(NOW, 0.5).say).toBe(openAside(NOW, 0.5).say);
  });
});

describe('decideAside', () => {
  const seed = () => openAside(NOW, 0).state;

  it('stays silent before the interval elapses', () => {
    const state = seed();
    const d = decideAside(NOW + ASIDE_INTERVAL_MS - 1, state, 0);
    expect(d.say).toBeNull();
    expect(d.state).toEqual(state); // untouched, including lastAsideAt
  });

  it('speaks a filler once the interval elapses and restamps lastAsideAt', () => {
    const at = NOW + ASIDE_INTERVAL_MS;
    const d = decideAside(at, seed(), 0);
    expect(d.say).not.toBeNull();
    expect(FILLERS).toContain(d.say!);
    expect(d.state.lastAsideAt).toBe(at);
    expect(d.state.lastPhrase).toBe(d.say);
  });

  it('prefers a mapped tool line over a filler and clears pendingTool', () => {
    const state = noteTool(seed(), 'terminal');
    const d = decideAside(NOW + ASIDE_INTERVAL_MS, state, 0);
    expect(TOOL_LINES.terminal).toContain(d.say!);
    expect(d.state.pendingTool).toBeNull();
  });

  it('falls back to the default pool for unknown tool labels', () => {
    const state = noteTool(seed(), 'mystery_gadget');
    const d = decideAside(NOW + ASIDE_INTERVAL_MS, state, 0);
    expect(TOOL_LINES.default).toContain(d.say!);
  });

  it('keeps pendingTool pending while the interval has not elapsed', () => {
    const state = noteTool(seed(), 'terminal');
    const d = decideAside(NOW + 1_000, state, 0);
    expect(d.say).toBeNull();
    expect(d.state.pendingTool).toBe('terminal');
  });

  it('never repeats the previous phrase back to back', () => {
    // With rand=0 both picks would land on the same index without the
    // lastPhrase filter; walk two consecutive fillers and compare.
    const first = decideAside(NOW + ASIDE_INTERVAL_MS, seed(), 0);
    const second = decideAside(NOW + 2 * ASIDE_INTERVAL_MS, first.state, 0);
    expect(second.say).not.toBeNull();
    expect(second.say).not.toBe(first.say);
  });
});

describe('noteTool', () => {
  it('records the label without touching the cadence clock', () => {
    const state = seedState();
    const noted = noteTool(state, 'skill_view');
    expect(noted).toEqual({ ...state, pendingTool: 'skill_view' });
  });

  function seedState() {
    return openAside(NOW, 0).state;
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/speech/__tests__/asides.test.ts`
Expected: FAIL — `Cannot find module '../asides'`

- [ ] **Step 3: Write the implementation**

Create `src/speech/asides.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/speech/__tests__/asides.test.ts`
Expected: PASS, all tests green

- [ ] **Step 5: Commit**

```bash
git add src/speech/asides.ts src/speech/__tests__/asides.test.ts
git commit -m "feat: pure aside policy — cadence, tool priority, phrase pools

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Tool label extraction in sanitize.ts

**Files:**
- Modify: `src/slack/sanitize.ts` (append after `isToolEcho`, around line 38)
- Test: `src/slack/__tests__/sanitize.test.ts` (append a new describe block)

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Task 3): `toolLabelFromEcho(raw: string): string | null` — lowercase first word after the leading emoji code, or `null` when the message doesn't open with one.

- [ ] **Step 1: Write the failing test**

Append to `src/slack/__tests__/sanitize.test.ts` (keep the file's existing imports; add `toolLabelFromEcho` to the import list from `'../sanitize'`):

```typescript
describe('toolLabelFromEcho', () => {
  it('extracts the label after the emoji code', () => {
    expect(toolLabelFromEcho(':computer: terminal\n```ls -la```')).toBe('terminal');
  });

  it('extracts underscored labels and drops the trailing colon', () => {
    expect(toolLabelFromEcho(':books: skill_view: slack-search')).toBe('skill_view');
  });

  it('lowercases the label', () => {
    expect(toolLabelFromEcho(':warning: Gateway restarting')).toBe('gateway');
  });

  it('tolerates leading whitespace', () => {
    expect(toolLabelFromEcho('  :computer: terminal')).toBe('terminal');
  });

  it('returns null for plain prose', () => {
    expect(toolLabelFromEcho('The Q3 doc is filed under Platform Planning.')).toBeNull();
  });

  it('returns null for an emoji code with nothing after it', () => {
    expect(toolLabelFromEcho(':computer:')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/slack/__tests__/sanitize.test.ts`
Expected: FAIL — `toolLabelFromEcho` is not exported

- [ ] **Step 3: Write the implementation**

Append to `src/slack/sanitize.ts` directly after `isToolEcho`:

```typescript
// First word after the tool-echo emoji prefix, e.g. ":computer: terminal …"
// → "terminal", ":books: skill_view: …" → "skill_view".
const TOOL_LABEL_RE = /^\s*:[a-z0-9_+\-]+:\s*([A-Za-z0-9_\-]+)/;

/**
 * The tool label of a tool-echo message (lowercased), or null when the text
 * doesn't open with an emoji-code prefix. Callers narrating tool activity
 * map this through their own phrase table — the label itself is an internal
 * name (skill_view, terminal) and never spoken verbatim.
 */
export function toolLabelFromEcho(raw: string): string | null {
  const m = TOOL_LABEL_RE.exec(raw);
  return m ? m[1].toLowerCase() : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/slack/__tests__/sanitize.test.ts`
Expected: PASS, including all pre-existing sanitize tests

- [ ] **Step 5: Commit**

```bash
git add src/slack/sanitize.ts src/slack/__tests__/sanitize.test.ts
git commit -m "feat: extract tool label from Eva's tool-echo messages

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: onToolActivity callback in useSlack

**Files:**
- Modify: `src/slack/useSlack.ts` (options interface ~line 31, callbacks ref ~line 51, `settleIfReply` ~line 81)

**Interfaces:**
- Consumes: `toolLabelFromEcho` from Task 2.
- Produces (used by Task 5): `UseSlackOptions.onToolActivity?: (label: string) => void` — fired once per tool-echo event that arrives while an ask is pending; label falls back to `'tool'` when extraction fails.

No unit test: the repo tests pure modules only, and this hook's logic is a two-line dispatch; wiring is covered by the on-device checklist in Task 5.

- [ ] **Step 1: Extend the options interface**

In `src/slack/useSlack.ts`, add to `UseSlackOptions` (after `onUnsolicited`):

```typescript
  /** Tool-echo activity seen while an ask is pending (label from toolLabelFromEcho). */
  onToolActivity?: (label: string) => void;
```

- [ ] **Step 2: Thread the callback through**

Update the destructure and callbacks ref (both lines):

```typescript
export function useSlack({ onUnsolicited, onIssue, onToolActivity }: UseSlackOptions = {}) {
```

```typescript
  const callbacks = useRef({ onUnsolicited, onIssue, onToolActivity });
  callbacks.current = { onUnsolicited, onIssue, onToolActivity };
```

Update the import from `./sanitize`:

```typescript
import { isToolEcho, speakableFromMrkdwn, toolLabelFromEcho } from './sanitize';
```

In `settleIfReply`, replace:

```typescript
      // Terminal echoes and other tool noise precede Eva's real answer —
      // let them fall through to the transcript and keep waiting.
      if (isToolEcho(raw)) return false;
```

with:

```typescript
      // Terminal echoes and other tool noise precede Eva's real answer —
      // surface them as activity, let them fall through to the transcript,
      // and keep waiting.
      if (isToolEcho(raw)) {
        callbacks.current.onToolActivity?.(toolLabelFromEcho(raw) ?? 'tool');
        return false;
      }
```

- [ ] **Step 3: Verify types and existing tests**

Run: `npx tsc --noEmit` — expected: clean.
Run: `npm test` — expected: all suites pass (no behavior change for existing paths).

- [ ] **Step 4: Commit**

```bash
git add src/slack/useSlack.ts
git commit -m "feat: surface tool-echo activity from pending asks via onToolActivity

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Aside choreography in useEcho

**Files:**
- Modify: `src/speech/useEcho.ts`

**Interfaces:**
- Consumes: `openAside`, `noteTool`, `decideAside`, `AsideState` from Task 1.
- Produces (used by Task 5):
  - `EchoHandlers.asides?: boolean` — enables asides on real ask rounds.
  - `noteToolActivity(label: string): void` — returned from `useEcho` alongside `listen`/`say`/`ask`/`cancel`; FaceScreen wires it to Slack's `onToolActivity`.

**Design invariants (from spec):**
- Asides speak only on the real ask path (`askEva` with an `ask` handler) — never the Phase-1 echo, never listen rounds.
- Every epoch bump clears aside state: `openMic`, `askEva` entry, `cancel`, unmount cleanup.
- A spoken aside flips the face to `speaking`, then back to `thinking` **only if the aside timer is still armed** — after the reply lands the timer is cleared first, so a settling aside can't stomp the reply's face mode.
- `speak()` already interrupts the active utterance, so the reply/timeout/offline lines cut any in-flight aside off automatically.
- Do not touch `convWindow` or `voiceRound` anywhere in the aside path.

- [ ] **Step 1: Add imports and refs**

In `src/speech/useEcho.ts`, add the import:

```typescript
import { decideAside, noteTool, openAside, type AsideState } from './asides';
```

Add `asides` to `EchoHandlers` (after `conversation`):

```typescript
  /** Spoken asides (opener, fillers, tool narration) during the ask wait. */
  asides?: boolean;
```

Update the hook signature and live-handlers ref:

```typescript
export function useEcho({ setMode, onHeard, onSaid, onPulse, onIssue, ask, onLatency, conversation, asides }: EchoHandlers) {
```

```typescript
  const handlers = useRef({ ask, onLatency, conversation, asides });
  handlers.current = { ask, onLatency, conversation, asides };
```

Add two refs next to `convWindow`/`voiceRound`:

```typescript
  // Aside machinery: pure decision state + the coarse tick driving it.
  // Non-null timer doubles as "this round still owns the thinking wait".
  const asideState = useRef<AsideState | null>(null);
  const asideTimer = useRef<ReturnType<typeof setInterval> | null>(null);
```

- [ ] **Step 2: Add clearAsides, speakAside, and noteToolActivity**

Insert after the `after` callback (before `settle`):

```typescript
  const clearAsides = useCallback(() => {
    if (asideTimer.current) clearInterval(asideTimer.current);
    asideTimer.current = null;
    asideState.current = null;
  }, []);

  /**
   * Speak a short aside without round consequences: face flips to speaking
   * for the utterance, then back to thinking — but only while the aside
   * timer is still armed, so an aside interrupted by the real reply (speak()
   * stops it, which reports done) can't stomp the reply's choreography.
   */
  const speakAside = useCallback(
    (text: string) => {
      const round = epoch.current;
      const live = () => round === epoch.current;
      speak(text, {
        onStart: () => {
          if (live()) setMode('speaking');
        },
        onBoundary: () => {
          if (live()) onPulse?.();
        },
        onDone: () => {
          if (live() && asideTimer.current) setMode('thinking');
        },
        onError: () => {
          if (live() && asideTimer.current) setMode('thinking');
        },
      });
    },
    [onPulse, setMode],
  );

  /** Tool-echo activity from Slack; the next due aside narrates it. */
  const noteToolActivity = useCallback((label: string) => {
    if (asideState.current) asideState.current = noteTool(asideState.current, label);
  }, []);
```

- [ ] **Step 3: Clear asides on every epoch bump**

Four sites. In `openMic`, directly after `const round = ++epoch.current;`:

```typescript
      clearAsides();
```

(and add `clearAsides` to `openMic`'s dependency array).

In `cancel`, after `epoch.current++;`:

```typescript
    clearAsides();
```

(add `clearAsides` to `cancel`'s dependency array).

In the unmount cleanup inside the `useEffect`, after `epoch.current++;`:

```typescript
      clearAsides();
```

(`useEffect` has an empty deps array with an eslint-disable — no array change needed.)

The `askEva` site is part of Step 4.

- [ ] **Step 4: Arm asides in askEva**

In `askEva`, replace:

```typescript
      const round = ++epoch.current;
      const heardAt = Date.now();
      const marks = { wokeAt: wokeAt.current, heardAt };
      clearTimer();
      setMode('thinking'); // held by the real round trip, not a cosmetic beat
      const result = await doAsk(text);
      if (round !== epoch.current) return; // cancelled or superseded mid-flight
```

with:

```typescript
      const round = ++epoch.current;
      clearAsides();
      const heardAt = Date.now();
      const marks = { wokeAt: wokeAt.current, heardAt };
      clearTimer();
      setMode('thinking'); // held by the real round trip, not a cosmetic beat
      if (handlers.current.asides) {
        const opened = openAside(Date.now(), Math.random());
        asideState.current = opened.state;
        speakAside(opened.say);
        // Coarse 1s tick; decideAside owns the real cadence. The interval
        // (not a chained timeout) keeps ticking across long Kokoro syntheses.
        asideTimer.current = setInterval(() => {
          if (!asideState.current) return;
          const d = decideAside(Date.now(), asideState.current, Math.random());
          asideState.current = d.state;
          if (d.say) speakAside(d.say);
        }, 1_000);
      }
      const result = await doAsk(text);
      if (round !== epoch.current) return; // cancelled or superseded mid-flight; owner already cleared our asides
      clearAsides(); // before deliver(), so a settling aside can't flip the mode back
```

Add `clearAsides` and `speakAside` to `askEva`'s dependency array:

```typescript
    [clearAsides, clearTimer, deliver, onIssue, sayBack, setMode, settle, speakAside],
```

**Ordering note:** the stale-round early return comes *before* `clearAsides()` — a superseded round must not clear the newer round's timer. The newer owner cleared this round's asides when it bumped the epoch (openMic/askEva/cancel all clear on entry).

- [ ] **Step 5: Return noteToolActivity**

Replace the return line:

```typescript
  return { listen, say, ask: askDirect, cancel };
```

with:

```typescript
  return { listen, say, ask: askDirect, cancel, noteToolActivity };
```

- [ ] **Step 6: Verify types and tests**

Run: `npx tsc --noEmit` — expected: clean.
Run: `npm test` — expected: all suites pass.

- [ ] **Step 7: Commit**

```bash
git add src/speech/useEcho.ts
git commit -m "feat: speak asides during the ask wait in useEcho

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: FaceScreen + DevControls wiring

**Files:**
- Modify: `src/face/FaceScreen.tsx`
- Modify: `src/controls/DevControls.tsx`

**Interfaces:**
- Consumes: `EchoHandlers.asides` + `noteToolActivity` (Task 4), `UseSlackOptions.onToolActivity` (Task 3).
- Produces: "Asides" dev toggle, persisted under `eva.asidesEnabled.v1`, default on.

- [ ] **Step 1: FaceScreen state, toggle, and plumbing**

In `src/face/FaceScreen.tsx`, add the storage key next to `CONV_ENABLED_KEY`:

```typescript
const ASIDES_ENABLED_KEY = 'eva.asidesEnabled.v1';
```

`useSlack` is created before `useEcho`, so route the callback through a ref to avoid the TDZ on `echo` (mirror of the existing `echoRef` pattern). Add directly **above** the `useSlack` call:

```typescript
  // useSlack mounts before useEcho; the ref bridges tool activity to it.
  const noteToolRef = useRef<(label: string) => void>(() => {});
```

Add to the `useSlack` options (after `onIssue: log,`):

```typescript
    onToolActivity: (label) => noteToolRef.current(label),
```

Add the persisted toggle state next to the conversation toggle block:

```typescript
  // Thinking asides: spoken fillers + tool narration during Eva's wait.
  // Persisted, default on.
  const [asidesEnabled, setAsidesEnabled] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(ASIDES_ENABLED_KEY).then((v) => {
      if (v === '0') setAsidesEnabled(false);
    });
  }, []);

  const toggleAsides = useCallback(() => {
    setAsidesEnabled((v) => {
      void AsyncStorage.setItem(ASIDES_ENABLED_KEY, v ? '0' : '1');
      return !v;
    });
  }, []);
```

Add `asides: asidesEnabled,` to the `useEcho` call (after `conversation: convEnabled,`), then connect the ref directly **after** the `useEcho` call:

```typescript
  noteToolRef.current = echo.noteToolActivity;
```

Pass the toggle to DevControls (next to `convEnabled`/`onToggleConv`):

```typescript
          asidesEnabled={asidesEnabled}
          onToggleAsides={toggleAsides}
```

- [ ] **Step 2: DevControls button**

In `src/controls/DevControls.tsx`, add to `DevControlsProps` (after `onToggleConv`):

```typescript
  asidesEnabled: boolean;
  onToggleAsides: () => void;
```

Add the button in the SPEECH row (after the Conversation Btn):

```typescript
            <Btn label="Asides" sub="thinking" active={props.asidesEnabled} onPress={props.onToggleAsides} />
```

- [ ] **Step 3: Verify types and full suite**

Run: `npx tsc --noEmit` — expected: clean.
Run: `npm test` — expected: all suites pass.

- [ ] **Step 4: Commit**

```bash
git add src/face/FaceScreen.tsx src/controls/DevControls.tsx
git commit -m "feat: asides toggle and tool-activity plumbing in FaceScreen

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### On-device verification checklist (manual, after Task 5)

JS-only change — no EAS rebuild needed; run via `npx expo start` on the dedicated iPhone.

1. Ask Eva a slow question ("Hey Eva" → something researchy). Expect: opener ("Let me see...") within ~1–2s of the thinking face, then a filler or tool line roughly every 12s, mouth animating during each aside, face returning to thinking between.
2. Watch the transcript for `eva ·` tool-echo lines; the next aside after one should be a tool line ("I'm running a quick check..." for terminal).
3. Confirm the reply interrupts an in-flight aside cleanly and the answer plays in full.
4. Toggle Asides off in the dev overlay (triple-tap top-left); repeat an ask — the wait should be silent like before.
5. Ask again with asides on and cancel mid-wait via a dev mode button; no aside should speak after the cancel.
