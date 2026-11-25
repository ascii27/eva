# Wake in Noise Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "Hi/Hello/Hey Eva" wake Eva reliably in a noisy room, record what she heard when she doesn't wake, and add a dev-overlay noise-filter toggle.

**Architecture:** Pure matching changes live in `wakeword.ts` (tested). `stt.ts` surfaces all recognizer alternatives and accepts a noise-filter flag. `useWakeWord` scans the alternatives and flushes one near-miss per recognizer session to a second capped AsyncStorage log. `FaceScreen` persists the toggle and threads it to both listen paths.

**Tech Stack:** React Native + Expo, expo-speech-recognition 56.0.4 (SFSpeechRecognizer), jest.

**Spec:** `docs/superpowers/specs/2026-11-25-wake-in-noise-design.md`

## Global Constraints

- Recognition stays `requiresOnDeviceRecognition: true`. Nothing new leaves the device.
- JS only. No new native modules, because it has to ship as an OTA update.
- A greeting prefix is always required. A bare "eva"/"ava" never wakes her.
- Pure modules import no React or AsyncStorage.
- The noise filter defaults to **off**.

## Review Focus

- "hey everyone" / "hi there" / "hello evan" must still not wake her. Pin these in the `findWake` tests.
- An interim that reads "hey ever" and then corrects to "hey eva" must log a wake, not a near-miss. That's why near-misses flush at session end and only when the session didn't hand off.
- A match only in a non-first alternative must still wake her. Pin it in the `findWakeIn` test.
- Flipping the noise filter while watching takes effect within one session. `useWakeWord` recycles the session on change.
- An empty `alternatives` array, which the native side can send, must not crash. `findWakeIn([])` returns null.

---

### Task 1: Pure matching (wakeword.ts)

**Files:** Modify `src/speech/wakeword.ts`. Test `src/speech/__tests__/wakeword.test.ts`.

**Interfaces — Produces:**
- `WAKE_RE` prefix group becomes `hey|hay|hei|hea|hi|hello|hallo|hiya`.
- `findWakeIn(transcripts: string[]): WakeMatch | null` returns the first `findWake` hit.
- `findNearMiss(raw: string): WakeMatch | null` returns null when `findWake` matches. Otherwise it matches on the same tail window: an Eva-like word (`eva|evah|evas|ava|iva|eve|ever|evan|ivy`), or a greeting word followed by a word starting with a vowel.
- `findNearMissIn(transcripts: string[]): WakeMatch | null`.

- [ ] Tests: `findWake` accepts 'hi eva', 'Hello, Eva!', 'hiya ava', 'hallo eva'. It still rejects 'hi there', 'hello evan', 'hey everyone', 'eva', and all existing cases. `findWakeIn(['heavy a', 'hey eva'])` is non-null and `findWakeIn([])` is null. `findNearMiss('hey ever')`, `findNearMiss('hi even')` and `findNearMiss('ask ava')` are non-null. `findNearMiss('hey eva')` is null, and so is `findNearMiss('hi there')`.
- [ ] Run `npx jest src/speech/__tests__/wakeword.test.ts`. Expect it to FAIL.
- [ ] Implement, sharing the tail-window logic between `findWake` and `findNearMiss` (extract a `tailOf(norm)` helper).
- [ ] Run again. Expect it to PASS. Commit.

### Task 2: Near-miss log (wakeLog.ts)

**Files:** Modify `src/speech/wakeLog.ts`. Test `src/speech/__tests__/wakeLog.test.ts`.

**Interfaces — Produces:** `NEAR_MISS_KEY = 'eva.wakeNearMiss.v1'`, `appendNearMiss(snippet)`, `getNearMisses()` and `clearNearMisses()`, with the same shape and `MAX_EVENTS` cap as the wake events. Both logs are built on one internal `capped log` helper, so the existing exports are unchanged.

- [ ] Test: append a near-miss and read it back. It must not appear in `getWakeEvents()`. Clearing it leaves the wake events intact.
- [ ] Run, FAIL. Implement. Run, PASS. Commit.

### Task 3: STT alternatives and the noise flag (stt.ts)

**Files:** Modify `src/speech/stt.ts`.

**Interfaces — Produces:**
- `SttResult.alternatives: string[]` holds every `e.results[i].transcript`. `transcript` is still `results[0]`.
- `startListening(profile?: ListenProfile, opts?: { noiseFilter?: boolean })` passes `iosVoiceProcessingEnabled: !!opts?.noiseFilter` and `maxAlternatives: 5`. The wake profile's `contextualStrings` become `['Eva', 'Hey Eva', 'Hi Eva', 'Hello Eva']`.

- [ ] Implement. Run `npx tsc --noEmit` and expect it to be clean. Commit together with Task 4.

### Task 4: Watcher and toggle wiring

**Files:** Modify `src/speech/useWakeWord.ts`, `src/speech/useEcho.ts`, `src/face/FaceScreen.tsx` and `src/controls/DevControls.tsx`.

**Interfaces — Consumes:** Tasks 1–3.

- `WakeWordOptions.noiseFilter?: boolean`. `onResult` uses `findWakeIn(r.alternatives)`. On a miss it stores `findNearMissIn(r.alternatives)` in a ref. `onEnd` flushes that ref via `appendNearMiss` unless the state is `handoff`, and resets it every session. When `noiseFilter` changes while watching, the hook recycles the session (`state='recycling'; abortListening()`).
- `useEcho` options gain `noiseFilter?: boolean`, read through a ref inside `startMic`.
- `FaceScreen` persists `eva.noiseFilter.v1` (`'1'`/`'0'`), defaulting to off, and passes it to both hooks. It loads near-misses the same way as wake events (on overlay open, and on clear).
- `DevControls` adds props `noiseFilter`, `onToggleNoiseFilter`, `nearMisses: WakeEvent[]` and `onClearNearMisses`. It adds a `Noise filter` Btn under Wake watching, and a `NEAR MISSES · n` header with CLEAR and lines in the same style as the wake log.

- [ ] Implement. Run `npx tsc --noEmit` and `npm test`, and expect both to be clean. Commit.
- [ ] On the device (manual): in a noisy room, try "Hi Eva" with the filter off and on, check that the speaker volume after Eva replies is unchanged, and read the near-miss log.
