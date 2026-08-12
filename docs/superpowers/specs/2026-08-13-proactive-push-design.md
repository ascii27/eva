# Proactive Push — Eva speaks unprompted

**Date:** 2026-08-13 · **Status:** approved

## Problem

Every utterance is user-initiated: wake word → listen → ask Eva → speak her reply. Eva works
asynchronously — a deck finishes rendering, a meeting moves, a long task completes — and has
no way to tell you. She posts to `#eva-direct` and the companion files it silently in the
transcript (`FaceScreen.onUnsolicited`, *"never spoken — the alert surfacing rules are
Phase 4"*).

Most of the path already exists: `useSlack` sees every Eva message on the channel,
`startRound` was built naming *"Eva-initiated replies"* as a caller, and the `alert` face
mode is fully implemented but reachable only from the dev overlay.

## Protocol

Eva **@-mentions the companion bot**. That adopts the thread. From then on every Eva post in
that thread is spoken — no further mention needed.

```
 Eva  @eva-companion The deck finished rendering.   ← adopts thread, spoken
 └─ companion  @Eva how many slides?                ← your voice answer, threaded
 └─ Eva  Forty-two.                                 ← spoken (settles the ask)
 └─ Eva  Also, the appendix is still rendering.     ← spoken (proactive, same thread)

 Eva  Unrelated top-level post, no mention          ← transcript only, silent
```

## Decisions

- **Adoption key** is the thread root (`thread_ts ?? ts`), so Eva can adopt with a fresh
  message or inside an existing thread.
- **Adoption expires after 30 min of thread silence**, refreshed by *any* Eva message in the
  thread — tool echoes and ask replies are activity too. Lazily checked, no timer (the
  `conversation.ts` deadline style). Bounded at 20 threads, memory only.
- **Voice answers post into the adopted thread.** A fresh "Hey Eva" question still posts
  top-level.
- **Tool echoes are never spoken.** `onUnsolicited` doesn't filter them today (only
  `settleIfReply` does) — speaking Eva's raw channel traffic is the real hazard here.
- **Queue until idle.** FIFO, capped at 5, oldest dropped on overflow (still in the
  transcript). Never interrupts a listen, an ask in flight, or speech.
- **Face:** `idle → alert (600ms) → speaking → pleased/idle`.
- **Follow-up mic after delivery** when conversation mode is on, reusing the existing 10s
  `FOLLOWUP_WINDOW_MS`.
- **Persisted dev toggle, default on** (`eva.proactiveEnabled.v1`), cloning the
  conversation/asides pattern. Off = today's transcript-only behavior.

No new native modules → no EAS rebuild. No Slack scope change: `channels:history` already
delivers thread replies, and we read every channel message, so `app_mentions:read` is
unnecessary.

## Architecture

Follows the `conversation.ts` / `asides.ts` house pattern: a pure, unit-tested policy module
with all timing and side effects driven from the hooks.

### New: `src/speech/proactive.ts` (pure, no React)

- `PROACTIVE_QUEUE_MAX = 5`, `ADOPTION_IDLE_MS = 30 min`, `ADOPTION_MAX = 20`.
- `ProactiveItem { ts, threadTs, text, at }`; `Adoptions = Record<threadRoot, lastActivityMs>`.
- `threadRoot(ev)` — `ev.thread_ts ?? ev.ts`.
- `mentionsBot(raw, botUserId)` — matches the `<@U…>` token.
- `receive(ev, now, botUserId, adoptions)` — the fold: prune expired, adopt on mention,
  refresh the thread clock for anything seen, cap to the newest `ADOPTION_MAX`, and return a
  `ProactiveItem` only for speakable messages in an adopted thread. Returns `item: null` for
  tool echoes and anything that sanitizes to empty (reuses `isToolEcho` /
  `speakableFromMrkdwn`).
- `enqueue` (reports the dropped item), `dequeue`, `dropTs`.

### Changed: `src/slack/api.ts`, `src/slack/protocol.ts`

- `postMessage(botToken, channel, text, threadTs?)` — sets `thread_ts` when given.
- `ReplyContext.askThreadTs?`; `isEvaReply` gains a branch for it: her answer must be in the
  same thread *and* after ours. Load-bearing — the existing threaded branch demands
  `ev.thread_ts === askTs`, which a threaded ask breaks, since Eva's reply carries the
  root's ts, not ours. Consequence: with a threaded ask, an Eva message outside that thread
  no longer settles it and falls through to the proactive path.

### Changed: `src/slack/useSlack.ts`

- `ask(text, threadTs?)` stores `askThreadTs` on the pending ask.
- `onUnsolicited` → **`onEvaMessage(ev, settledAnAsk)`**, fired for every Eva channel message
  whether or not it settled an ask. Adoption must refresh on ask replies too, and those
  return early today. Also fired from `ask()`'s `recentEvents` replay loop.
- Exposes `botUserId` so `mentionsBot` can run.

### Changed: `src/speech/useEcho.ts`

- `ALERT_BEAT_MS = 600` and `announce(text)`: bump epoch, `setMode('alert')`, then
  `deliver(text, 'pleased')` after the beat. Sets `voiceRound = true` so the delivery earns
  the follow-up mic. `useEcho` learns nothing about threads — FaceScreen injects those into
  the `ask` closure.
- The epoch guard inside the beat callback is required: `openMic` bumps the epoch before its
  awaits but doesn't `clearTimer()` until after them, so a pending beat can fire stale.
- `voiceRound`'s comment updated — it now means "round that earns follow-ups", not
  "mic-originated".

### Changed: `src/face/FaceScreen.tsx`, `src/controls/DevControls.tsx`

- Refs for `adoptions`, the pending queue, and `activeThread`, plus a `proactiveNonce`
  counter — without the nonce, a message arriving while already idle changes no state and
  never drains (same trick as `blinkNonce`/`yawnNonce`).
- Drain effect gated on `mode === 'idle' && !echoBusy`, starting the round through
  `startRound` so the wake watcher stands down before Eva speaks.
- `ask` closure routes through `activeThread`, which the drain sets and every non-proactive
  round starter (`onWake`, dev Ask/Speak) clears.
- "Proactive" toggle and a "Proactive test" button in the dev overlay's SPEECH section.

## Edge cases

- **Double-speak race.** `ask()` replays a buffered `recentEvents` window because a fast Eva
  reply can beat `chat.postMessage`'s own HTTP response. Such an event already fired
  `onEvaMessage(ev, false)` and may sit in the queue, then settles the ask and gets spoken as
  the reply. Handled by `dropTs` plus firing `onEvaMessage(ev, true)` from the replay loop.
- **Wake-watcher churn.** A round ending clears `echoBusy`, the watcher un-suspends, and the
  drain effect re-suspends it in the next commit — one extra abort/restart per queued
  message. `useWakeWord`'s `recycling` state and `RESUME_SETTLE_MS` absorb it; watch on device.
- **Backlog pacing.** With conversation on, item 1's 10s follow-up window lapses before item 2
  speaks. Intentional — Eva shouldn't machine-gun the room.
- **Late ask replies.** A round that hits the 90s `ASK_TIMEOUT_MS` promises the answer will
  "show up in the transcript". If the ask was threaded, that answer now gets *spoken*.
- **Unpaired / Expo Go:** no Slack, no adoptions, no queue. The dev test button still
  exercises announce → alert → speak.

## Testing

- `src/speech/__tests__/proactive.test.ts` — adoption on mention, speaking within an adopted
  thread without a mention, silence for unknown threads, tool echoes refreshing the clock
  without producing an item, expiry and refresh, `ADOPTION_MAX` pruning, queue cap/FIFO/drop.
- `src/slack/__tests__/protocol.test.ts` (extend) — `isEvaReply` with `askThreadTs`.
- Hook wiring verified on device (same manual bar as conversation mode and asides).

## Out of scope (YAGNI)

- Urgency levels or barge-in for proactive messages.
- Persisting adoptions across relaunch.
- Delivery while backgrounded (no push notifications; the app is keep-awake and foregrounded).
- Quiet hours / do-not-disturb — Phase 4 appliance hardening.
