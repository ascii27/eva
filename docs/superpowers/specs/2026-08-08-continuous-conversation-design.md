# Continuous Conversation Mode — Design

**Date:** 2026-08-08 · **Status:** approved

## Problem

Every exchange with Eva is wake-word gated: "Hey Eva" → listen → think → speak → idle.
Natural conversation needs turn-taking: after an exchange, Eva should keep listening for
follow-ups and only fall back to wake-word mode after an idle timeout.

## Decisions

- **Barge-in deferred.** Mic stays off while Eva speaks; listening re-opens only after TTS
  completes. (The TTS stop path is already barge-in-ready; the blocker is mic-during-TTS
  echo cancellation — a later on-device experiment.)
- **~10s follow-up window** after each spoken reply, refreshed on every delivered reply.
  Silence does not extend the window.
- **Native iOS end-of-utterance.** Reuse the existing `'command'` STT profile: iOS ends a
  silent session after ~3s (iOS 17) / on `isFinal` (18+). No VAD, no `volumechange`
  metering, no new native deps — JS-only, no EAS rebuild.
- **Architecture:** turn-taking policy is a pure module `src/speech/conversation.ts`
  (no React imports, unit-tested); `useEcho` grows a follow-up continuation that consults it.

## Policy (`src/speech/conversation.ts`)

`decideNext(outcome, now, window)` where `window` is the epoch-ms deadline (null = closed):

| Outcome | Result |
|---|---|
| `reply-delivered` | `listen-again`, window = `now + FOLLOWUP_WINDOW_MS` (always refresh) |
| `empty-listen` in window (`now < window`) | `listen-again`, window unchanged |
| `empty-listen` otherwise | `end`, window null |
| `ask-failed` (timeout/offline/error) | `end`, window null — the error line already speaks; re-opening the mic would loop identical failures |

No timer enforces the deadline — it is checked lazily at each natural STT session end
(~3s silence self-termination), so the conversation ends at most ~3s past the nominal
deadline. No max-turn cap (single trusted user; each turn requires ≥0.35-confidence speech).

## Choreography (`src/speech/useEcho.ts`)

- `openMic()` extracted from `listen()` (epoch bump, ensureReady, 300ms TTS-teardown
  settle, `setMode('listening')`, `startListening()`). `listen()` = mark voice round +
  close window + `openMic(wokeAtMs)`; follow-ups call `openMic()` so latency lines lack
  the wake mark.
- After a `pleased` delivery on a voice round with conversation enabled: pleased beat
  (the "your turn" cue), then re-listen instead of settling to idle.
- Empty/low-confidence sessions during the window silently re-listen (no confused flash
  for ambient chatter); window expiry exits quietly to idle. The confused beat remains
  exclusive to the wake-gated first listen. Handled on both the `onEnd` empty path and the
  `no-speech` error path (iOS reports silent sessions either way).
- Dev `say()`/typed-ask rounds never open the mic afterwards. `cancel()`/unmount clear
  conversation state; the existing epoch guard covers all in-flight continuations.
- Echo mode (unpaired, no `ask`) gets follow-ups for free — testable without Slack.

## UX

- **No new FaceMode.** Follow-up listening reuses `'listening'` — the semantic is
  listening, and a new mode would require animation values not in the approved design doc.
- **Wake watcher unchanged.** Mode never returns to `'idle'` mid-conversation, so the
  existing `suspended: echoBusy || mode !== 'idle'` keeps it off; it re-arms ~400ms after
  the quiet exit. Wake-on-own-voice prevention preserved.
- **Dev overlay:** persisted "Conversation" toggle (`eva.convEnabled.v1`), default ON,
  cloning the wake-enabled pattern.

## Invariants preserved

On-device-only STT (privacy), single-utterance TTS settle, epoch guard on every async
continuation, wake watcher never live during a round, Expo Go graceful degradation.
