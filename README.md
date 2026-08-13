# Eva Companion

A dedicated-iPhone appliance app that gives Eva — a chief-of-staff agent reachable through Slack — a physical presence: an always-on robot face in landscape, with on-device speech in both directions.

This repo is the **client**. Eva's reasoning, her Notion stewardship, and the Slack relay are out of scope. See the PRD for the full product picture.

## Status: Phase 1 — device foundation

- ✅ Landscape-locked Expo app, keep-awake, black-canvas robot face
- ✅ Full state vocabulary (idle / listening / thinking / speaking / alert / confused / pleased), autonomous blink + late-night yawn, 13-viseme lip-sync mouth with waveform fallback
- ✅ On-device TTS (`expo-speech`) and on-device STT (`expo-speech-recognition` with `requiresOnDeviceRecognition` — the app refuses to listen if on-device recognition is unsupported rather than sending audio to the network)
- ✅ Echo loop for verification: listen → thinking → speak the transcript back
- 🔶 Wake word "Hey Eva" (Phase 2): implemented — continuous on-device recognition with fuzzy phrase matching (Porcupine's free tier was discontinued June 2026), wake-event log for false-trigger measurement; device verification pending
- ✅ Live Eva over Slack (Phase 3): Socket Mode link, ask round trip, continuous conversation follow-ups, spoken asides during the wait, Kokoro-82M on-device TTS
- ✅ Proactive push: Eva speaks first (see below)
- ⬜ Appliance hardening (Phase 4)

### Proactive push — Eva speaking first

Eva **@-mentions the companion** in the channel. That adopts the thread; from then on
everything she posts in it is spoken, no further mention needed. Her tool echoes stay silent,
and unmentioned top-level chatter never speaks at all.

```
 Eva  @eva-companion The deck finished rendering.   ← adopts the thread, spoken
 └─ companion  @Eva how many slides?                ← your answer, threaded
 └─ Eva  Forty-two.                                 ← spoken
 └─ Eva  Also, the appendix is still rendering.     ← spoken, no mention needed
```

Messages queue until Eva is genuinely idle — a push never cuts off a listen, an ask in
flight, or her own speech. She widens her eyes (`alert`) before speaking so you can tell she's
initiating rather than answering, and with conversation mode on the mic opens afterwards so
you can reply without the wake word. A thread stops speaking after 30 minutes of silence.

## Development

```bash
npm install
npm test              # pure-math tests for the face (geometry, visemes)
npx tsc --noEmit      # typecheck
npx expo start --go   # face-only in Expo Go / simulator (no STT — needs dev build)
```

The face, dev controls, and TTS all work in Expo Go. Speech *recognition* requires the dev build.

**Dev controls:** triple-tap the top-left corner of the screen to open the control overlay (states, blink/yawn, mouth output, side column, eye color, viseme freeze, speak/listen tests, conversation/asides/proactive toggles, Slack pairing and a typed-ask box).

## Dev build on the dedicated iPhone (one-time)

Native speech modules don't run in Expo Go, so the device runs an EAS development build; JS updates load from Metro (and later OTA) without rebuilding.

```bash
npm i -g eas-cli
eas login
eas device:create          # register the dedicated iPhone (opens a URL on the phone)
eas build --profile development --platform ios
# install the build from the QR/link on the phone, then:
npx expo start             # dev-client mode; open the app on the phone
```

Device setup, one-time, in iOS Settings:
- **Enhanced voice**: Settings → Accessibility → Spoken Content → Voices → English — download an Enhanced voice; the app prefers Enhanced-quality English voices and persists its pick.
- **On-device dictation**: iOS downloads the on-device speech model automatically for the device language; verify with the airplane-mode test below.

### Verification on device

1. Triple-tap top-left → **Listen** → say something → Eva should think, then echo it back, then look pleased.
2. **Airplane-mode test** (the privacy invariant): with all radios off, Listen and Speak test must both still work. If STT errors offline, the on-device model isn't installed — check dictation language settings.
3. Leave it on the desk: eyes should drift and blink on their own, and after 22:00 the face starts yawning.
4. **Proactive push**: with the overlay open, tap **Proactive test** while Eva is idle — the eyes should widen (side column reads `Eva · initiating`) before she speaks. Tap it three times fast: the lines should queue and play in order, never overlapping. Tap **Speak test** and then **Proactive test** mid-sentence: the push must wait, not interrupt. Then, on Slack, have Eva `@`-mention the companion — that line should speak, a follow-up post in the same thread should speak without a mention, and an unmentioned top-level post should stay silent. Answer her without the wake word and confirm in Slack that your question landed as a **threaded reply**; a fresh "Hey Eva" question must still post at channel level.
5. **Wake word**: in the overlay, enable **Wake watching** (persists across relaunches; side column shows `EVA · WATCHING` while idle). Say "Hey Eva", pause, then speak — the face pops to listening, echoes the sentence back, and resumes watching. Each detection lands in the overlay's WAKE LOG with a timestamp and the transcript snippet that triggered it; for the false-trigger measurement, clear the log in the morning and classify the day's entries in the evening. A Speak-test line containing "Hey Eva" must *not* trigger a wake (watching suspends whenever Eva isn't idle).

## Architecture

```
App.tsx                    keep-awake + status-bar-hidden shell
src/face/
  constants.ts             every number from the design (876×408 canvas, eye 104×132, gap 300, …)
  geometry.ts              pure math: per-mode eye deformation, blink/yawn envelopes (unit-tested)
  visemes.ts               13 phoneme mouth shapes, demo sequence, waveform amplitudes (unit-tested)
  Face.tsx                 Skia renderer — eyes (blur-glow layers) on the Reanimated UI-thread clock,
                           mouth visemes on a 112ms swap, waveform bars
  SideColumn.tsx           connection status, "last said", transcript log
  FaceScreen.tsx           state owner: mode, output, color; wires echo loop + dev controls
src/controls/DevControls.tsx  hidden overlay (triple-tap top-left)
src/speech/
  tts.ts                   expo-speech wrapper; Enhanced-voice pick persisted
  stt.ts                   on-device STT wrapper; lazy-loads the native module so Expo Go still runs
  proactive.ts             thread adoption + backlog policy for Eva-initiated messages
  useEcho.ts               listen → thinking → speak-back loop with face choreography
src/slack/
  useSlack.ts              Socket Mode link, pairing, and the ask round trip
```

The face is a direct port of the approved design (`Eva Face.dc.html` in the claude.ai/design project): all animation is the same geometry deformed — scale, translate, corner radius, glow — driven by continuous time. The design's separation toggle was dropped (fixed wide) and the side column defaults to visible, per review.
