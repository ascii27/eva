# Wake word that hears you in a noisy room (ASC-37)

## Why

At the desk, people had to say "Hey Eva" several times, and "Hi Eva" mostly got no
beep at all. She only responded once someone came close and said it clearly, in a
room that was probably noisy. The problem is that she misses the wake phrase, not
that she is slow to respond. Success means one normal-volume greeting from across
the desk wakes her, and that we have data showing what she heard when she still
misses.

## Goals

- "Hi Eva", "Hello Eva" and "Hiya Eva" wake her, as well as "Hey Eva".
- Use every alternative transcript the recognizer offers, not only its first guess.
- Record near-misses so the next round of tuning works from evidence.
- Let the person at the desk switch Apple's noise and echo suppression on and off,
  and compare the two in a real room.

## Non-goals

- Wake-to-first-word latency, and a quick spoken reply to greetings.
- A dedicated wake-word engine. That is filed as ASC-39 and is only worth it if
  this change isn't enough.

## Anti-goals

- She wakes on ordinary room talk. A bare "Eva" or "Ava" must still not trigger,
  so a greeting word is always required in front.
- Audio or transcripts leaving the device. Recognition stays strictly on-device.
- Anything that needs an EAS rebuild. Everything here ships as an OTA update.

## Approaches

- **A. Wider phrase + all alternatives + near-miss log.** JS only, low risk.
- **B. A, plus a noise-suppression toggle in the dev overlay** (`iosVoiceProcessingEnabled`,
  already compiled into the installed expo-speech-recognition). **Chosen.** It costs
  little more than A, and it shows whether noise filtering helps before anything
  heavier is considered. Unknown: it can switch the audio session to voiceChat and
  lower speaker volume, which is why it is a toggle rather than the default.
- **C. Dedicated wake-word engine (Porcupine and similar).** Best in noise, but it
  needs a native module, a rebuild and a vendor key. Deferred to ASC-39.

## Design

1. **Phrase** (`wakeword.ts`, pure and tested): `WAKE_RE`'s prefix group gains
   `hi|hello|hiya` (plus a likely mishearing or two, such as `hallo`). Everything else
   stays as it is, including the required prefix and the Eva variants.
2. **Alternatives** (`stt.ts`): `SttResult` gains `alternatives: string[]`, holding
   every transcript in the event (`results[0]` stays `transcript`). The wake watcher
   runs `findWake` over each and takes the first match. The command profile doesn't
   need them. `maxAlternatives` is set explicitly to 5, which matches the native
   default, so nothing depends on that default staying put.
3. **Hint words**: `contextualStrings` for the wake profile becomes
   `['Eva', 'Hey Eva', 'Hi Eva', 'Hello Eva']`.
4. **Near-miss log** (`wakeword.ts` pure matcher plus a log next to `wakeLog.ts`):
   a transcript tail that has a greeting word, or an Eva-like word
   (`eva|ava|iva|eve|ever|evan|ivy`), but no wake match is a near-miss. Store its
   snippet the same way as wake events, at most once per recognizer session and only
   when the snippet changes, FIFO-capped. Show it in the dev overlay under the wake
   log, with its own clear. It stays on the device. It does store fragments of room
   talk, which is why each fragment is a short snippet and the log is capped.
5. **Noise filter toggle**: a persisted AsyncStorage flag. It is passed into
   `startListening` as `iosVoiceProcessingEnabled` for **both** the wake and command
   profiles, because the question after "Hi Eva" is spoken into the same noisy room.
   *(My call: one toggle, not one per profile.)* The overlay shows it as
   "Noise filter" next to "Wake watching". It defaults to off until it has been
   tested at the desk.

## Left to the builder

- The exact near-miss pattern and the log cap. Keep it in line with `MAX_EVENTS`.
- How the toggle reaches `stt.ts`. Prefer an argument to a module global, so the
  pure/effectful split holds.

## Verification

- Unit tests for the new prefixes, the alternatives scan and the near-miss
  classifier. That includes "hi Eva" matching and "Eva said" / "hi there" not
  matching as wakes.
- On the device, with the room noisy: try greetings with the filter off and on,
  check speaker volume after the filter is enabled, and read the near-miss log.
