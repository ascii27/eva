# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Eva Companion: a React Native + Expo app for a **single dedicated iPhone** sitting on a desk in **landscape** — an always-on robot face for Eva (a chief-of-staff agent), with on-device speech both directions. Not for the App Store; iOS only; one device. The PRD phases: 1 device foundation (done), 2 wake word, 3 live Eva over Slack (done), 4 appliance hardening.

Beyond the PRD: Eva now also runs as a **local agent loop** (`src/agent/`) talking straight to the OpenAI chat API, which is the default brain. Slack remains switchable from the dev overlay — it is still the only route to the real hermes-agent's tools, and the only source of proactive pushes.

## Commands

```bash
npm test                      # jest (pure face-math tests); npx jest src/face/__tests__/geometry.test.ts for one file
npx tsc --noEmit              # typecheck (TS 6 — @types globals are NOT auto-included; tests import from @jest/globals)
npx expo start --go           # run face in Expo Go / simulator (STT unavailable there by design)
npx expo start                # dev-client mode for the physical iPhone with the EAS dev build
eas build --profile development --platform ios   # rebuild native shell (only when native deps change)
```

## Architecture

The face is a **port of an approved design** (`Eva Face.dc.html` in the claude.ai/design project "Eva Face") — all magic numbers in `src/face/constants.ts` come from it. Don't invent new animation values; change the design first, then port.

Two layers, deliberately separated:

- **Pure math** (`src/face/geometry.ts`, `src/face/visemes.ts`): per-mode eye deformation `eyeGeo(side, t, mode, blinkT, yawnT)`, blink/yawn envelopes, viseme table, waveform amplitudes. No React imports. Unit-tested; marked `'worklet'` because they also run on the Reanimated UI thread. Keep them pure.
- **Rendering** (`src/face/Face.tsx`): Skia canvas. Continuous animation (eye transforms, glow blur, waveform) runs on the UI thread via `useFrameCallback` + derived values reading shared values (`clock`, `blinkT`, `yawnT`); discrete changes (mode, viseme swap every 112ms, colors) are React state. The blink/yawn scheduler lives inside the frame callback (idle only). Corner radii use CSS clamping semantics — `clampCorners` replicates browser border-radius overlap rules.

`src/face/FaceScreen.tsx` owns all state (mode, mouth output, color, side column, transcript) and wires the echo loop + dev controls. The dev overlay opens on **triple-tap top-left**.

The round contract (`src/round/`) is what keeps the two brains interchangeable: `ask(text) => Promise<AskResult>` plus `formatLatency`, and `speakableFromMrkdwn` (flattens both Slack mrkdwn and plain markdown for the ear). `useEcho` switches on `AskResult` and cannot tell which brain answered. Don't reach back into `src/slack/` for these.

Local agent (`src/agent/`) — same pure/effectful split as everything else:
- `history.ts` is the policy and holds the interesting decisions: session-gap detection, token-budget compaction (`planCompaction` never splits a user/assistant pair; `applyCompaction` drops by *count* so turns arriving mid-summarization survive), and `buildRequest`'s message layout. That layout is load-bearing for cost: persona + remembered summaries go in one leading system message that stays byte-identical for the whole session, so a compaction rewriting the running-summary message doesn't invalidate the cached prefix. Prompt caching needs ≥1024 prefix tokens, so it starts paying a few turns in, not on turn one.
- `store.ts` deliberately uses expo-file-system rather than AsyncStorage: one JSON file per archived session under `<documents>/eva/memory/`, named by `sessionId()` so listing sorts chronologically. That's the unit a future exe.dev sync would push.
- `useAgent.ts` owns all timing: the mount-time gap archive, the 30s abort, and compaction fired *after* a reply is on its way to the speaker, never in the round's critical path.
- `persona.ts` is Eva's local system prompt. It has no tools, so it's told to say so rather than imply it acted. Voice rules are shared with `docs/eva-proactive-prompt.md` — change both together.
- Replies **stream**, so time-to-first-audio no longer scales with reply length: `openai.chatStream` (XHR, because RN's fetch can't stream a response body — and `onprogress` must be assigned *before* `send()` or RN delivers the body in one lump) → `sse.ts` → `sentences.ts` → `tts.speakStream` → one long-lived Kokoro stream. Two non-obvious constraints: `sentences.ts` exists for the *sanitizer*, not for Kokoro (which partitions natively) — `speakableFromMrkdwn` can't unwrap half a `**bold**` span, so flattening happens only at sentence boundaries; and Kokoro's `stopAutomatically` is decided at the moment the stream goes live, from whether all input has already arrived (see `runStream`) — it cannot be hoisted to a constant, because `Kokoro::stream()` assigns `stopOnEmptyBuffer_` from its own parameter as it starts, clobbering any earlier `streamStop(false)`. The system voice can't stream and buffers to completion instead.
- `useEcho` opens the speech stream **lazily on the first delta**, which is also how it decides the delivery path: a transport that can't stream (Slack) simply never calls `onDelta` and gets the old whole-utterance path. There's no capability flag by design. The invariant to preserve when touching `askEva`: every exit either settles the face or leaves an open `speech.current` whose drain callback will — a face wedged in `thinking` leaves the wake watcher suspended and the appliance deaf.

Speech (`src/speech/`):
- `stt.ts` lazy-requires `expo-speech-recognition` so Expo Go (no native module) still runs the face. **Privacy invariant: `requiresOnDeviceRecognition: true`, and refuse to listen rather than fall back to network recognition.** Note: the PRD's preferred `expo-speech-transcriber` was rejected — its realtime path never sets the on-device flag.
- `tts.ts` picks and persists one Enhanced-quality English system voice (Eva's canonical voice).
- `useEcho.ts` is the round choreographer: listen → thinking → speak. Without an `ask` handler it falls back to the Phase-1 echo (speak the transcript back); with one it asks whichever brain is selected and speaks the reply. `announce()` is the reverse direction — Eva speaking first.
- Policy lives in pure, unit-tested modules with no React, and all timing/side effects stay in the hooks: `conversation.ts` (follow-up window), `asides.ts` (filler cadence), `proactive.ts` (thread adoption + backlog for Eva-initiated messages). Follow that split when adding behavior.

## Constraints

- Orientation is locked landscape in `app.json`; keep-awake is on in `App.tsx`. Don't add portrait handling.
- Eye separation is fixed wide (300px gap) and the side column defaults to visible — both explicit product decisions; don't resurrect the toggles from the design doc.
- Native module changes (new Expo packages with native code) require a new EAS dev build on the dedicated iPhone; JS-only changes do not.
