# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Eva Companion: a React Native + Expo app for a **single dedicated iPhone** sitting on a desk in **landscape** — an always-on robot face for Eva (a Slack-reachable chief-of-staff agent), with on-device speech both directions. Not for the App Store; iOS only; one device. The PRD phases: 1 device foundation (done), 2 wake word, 3 live Eva over Slack, 4 appliance hardening.

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

Speech (`src/speech/`):
- `stt.ts` lazy-requires `expo-speech-recognition` so Expo Go (no native module) still runs the face. **Privacy invariant: `requiresOnDeviceRecognition: true`, and refuse to listen rather than fall back to network recognition.** Note: the PRD's preferred `expo-speech-transcriber` was rejected — its realtime path never sets the on-device flag.
- `tts.ts` picks and persists one Enhanced-quality English system voice (Eva's canonical voice).
- `useEcho.ts` is the round choreographer: listen → thinking → speak. Without a Slack `ask` handler it falls back to the Phase-1 echo (speak the transcript back); with one it posts to Eva and speaks her reply. `announce()` is the reverse direction — Eva speaking first.
- Policy lives in pure, unit-tested modules with no React, and all timing/side effects stay in the hooks: `conversation.ts` (follow-up window), `asides.ts` (filler cadence), `proactive.ts` (thread adoption + backlog for Eva-initiated messages). Follow that split when adding behavior.

## Constraints

- Orientation is locked landscape in `app.json`; keep-awake is on in `App.tsx`. Don't add portrait handling.
- Eye separation is fixed wide (300px gap) and the side column defaults to visible — both explicit product decisions; don't resurrect the toggles from the design doc.
- Native module changes (new Expo packages with native code) require a new EAS dev build on the dedicated iPhone; JS-only changes do not.
