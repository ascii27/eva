# Thinking Asides — filler speech and tool narration during Eva's wait

**Date:** 2026-08-08
**Status:** Approved

## Problem

An ask round holds the face in `thinking` for the whole round trip — typically
10–90 seconds of dead silence. The user can't tell whether Eva is working,
stuck, or lost the question. Eva's tool traces (`:computer: terminal`,
`:books: skill_view: …`) arrive during the wait but are silently skipped by
`isToolEcho`, so the one signal that *would* explain the pause is discarded.

## Goal

Fill the wait with short spoken "asides" so the pause feels purposeful:

- An **opener** the moment the round enters `thinking` ("Let me see...").
- A spoken update roughly every **12 seconds** after that:
  - a **tool line** if tool activity arrived since the last aside
    ("I'm running a quick check..."), else
  - a generic **filler** ("Hmmm...", "Still working on it...").
- Silence never stretches past ~12–15s; tool activity beats generic filler.

## Architecture

Follows the `conversation.ts` pattern: a pure, unit-tested decision module,
with all timing/side effects driven from `useEcho`.

### New: `src/speech/asides.ts` (pure, no React)

- Phrase pools:
  - `OPENERS` — "Let me see...", "Hmm, okay, give me a moment...", …
  - `FILLERS` — "Hmmm...", "Still working on it...", "One moment...", …
  - `TOOL_LINES` — keyed by tool label with a `default` fallback:
    - `terminal` → "I'm running a quick check...", …
    - `skill_view` / lookup-ish → "I'm looking that up...", …
    - web/search → "I'm searching for that...", …
    - unknown → "I'm investigating...", …
- `ASIDE_INTERVAL_MS = 12_000`.
- State: `{ lastAsideAt: number; pendingTool: string | null; lastPhrase: string | null }`.
- `openAside(rand): string` — picks an opener.
- `noteTool(state, label): AsideState` — records tool activity for the next tick.
- `decideAside(now, state, rand): { say: string | null; state: AsideState }` —
  returns a line when the interval has elapsed (tool line if `pendingTool`
  is set, clearing it; filler otherwise), else `say: null`. Never returns the
  same phrase twice in a row (`lastPhrase`); `rand` is caller-passed so the
  module stays pure and testable.

### Changed: `src/slack/sanitize.ts`

- `toolLabelFromEcho(raw): string | null` — pure extraction of the tool label
  from a tool-echo message: the first word(s) after the leading emoji code,
  e.g. `:computer: terminal …` → `terminal`, `:books: skill_view: …` →
  `skill_view`. Returns `null` when the shape doesn't match.

### Changed: `src/slack/useSlack.ts`

- New option `onToolActivity?: (label: string) => void`, fired in
  `settleIfReply` at the exact spot `isToolEcho` currently swallows the
  message while an ask is pending. Label comes from `toolLabelFromEcho`
  (generic fallback label when it returns `null`).

### Changed: `src/speech/useEcho.ts`

- New handler `asides?: boolean` (mirrors `conversation`) plus a
  `noteToolActivity(label)` function returned from the hook for FaceScreen
  to wire to Slack's `onToolActivity`.
- `askEva`, when asides are enabled and the round uses the real `ask` path:
  - speaks an opener right after `setMode('thinking')`;
  - arms a repeating timer that calls `decideAside` and speaks the result;
  - a spoken aside flips the face to `speaking` for its duration, then back
    to `thinking` (epoch-guarded both sides);
  - clears the aside timer the moment `doAsk` resolves (reply, timeout,
    offline, or error) or the round is cancelled/superseded.
- Delivery already interrupts: `speak()` calls `stopSpeaking()` first, so a
  reply landing mid-aside cuts the filler off and answers immediately.
- The aside path must not touch `convWindow`/`voiceRound` — asides are
  cosmetic and never affect round outcomes or the follow-up window.

### Changed: `src/face/FaceScreen.tsx` + `src/controls/DevControls.tsx`

- Plumb `onToolActivity` → `noteToolActivity`.
- "Asides" dev toggle beside the conversation toggle. **Default: on.**

## Edge cases

- **Reply mid-aside:** `deliver()`'s `speak()` interrupts the aside; the aside's
  settle callback sees a stale epoch (or the timer was cleared) and does not
  flip the mode back to `thinking`.
- **Cancel/supersede mid-aside:** `cancel()` bumps the epoch and stops
  speech — the aside timer is cleared alongside the existing round timer.
- **Echo fallback (no `ask`):** the Phase-1 echo path never speaks asides —
  its "thinking" beat is 300ms of theater, not a real wait.
- **Timeout/offline lines:** unchanged; they interrupt any aside like a
  reply does.
- **Mic:** never open during `thinking`, so asides cannot collide with STT.
- **Kokoro:** short phrases synthesize on demand; no pre-caching. Revisit only
  if aside latency is noticeable on device.

## Testing

- `src/speech/__tests__/asides.test.ts` — opener pick, cadence (no line
  before the interval, line after), tool-beats-filler, `pendingTool` cleared
  after being spoken, no immediate phrase repeats, `rand` determinism.
- `src/slack/__tests__/sanitize.test.ts` (extend) — `toolLabelFromEcho`
  shapes: `:computer: terminal cmd`, `:books: skill_view: name`, plain prose
  → `null`.
- Hook wiring verified on device (same manual bar as conversation mode).

## Out of scope (YAGNI)

- Pre-synthesized/cached aside audio.
- Topic extraction from tool payloads ("investigating X" from a command line).
- Volume ducking, barge-in (interrupting Eva by talking over an aside).
