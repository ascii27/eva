# Vision — letting Eva see through the iPhone camera

Eva can hear, speak, remember, and search. She cannot look. This adds a
`camera_look` tool to the local agent loop so she can take a photo through the
front camera and reason about it.

Three product constraints, agreed before any code:

1. **She always asks permission out loud and waits for a spoken yes.** Not a
   persona instruction she might skip — a machine-enforced gate. Nothing
   audible, no shutter.
2. **The captured frame appears as a thumbnail in the side column.**
3. **Recent photos stay attached to the conversation**, so "what about the left
   side?" works without a second shutter.

Retention is deliberately shallow: photos live in the app *cache*, only the
last two are ever re-sent, and nothing image-shaped reaches the durable
session archive.

## The hard part is not the camera

`camera_look` has to pause mid tool-loop and block on a human, while `useEcho`
is streaming Eva's voice through Kokoro. Three facts in the existing code
force the shape:

- `openMic` calls `stopSpeaking()` plus a 300ms audio-session teardown, and
  `stopSpeaking()` kills an open Kokoro stream. `speech.hold(true)` is not
  enough — the stream has to be *ended and drained* before the mic opens.
- `speech.current.end()` drains into `finishSpoken`, which settles the round
  and opens the *follow-up* mic. Undiverted, that collides with the consent
  listen.
- `useEcho`'s mount-once `onEnd` routes every final transcript into `askEva`.
  Undiverted, "yeah go ahead" starts a new round that kills the one waiting on
  it.

### Sequence

```
model streams "mind if I take a look?" + tool_call camera_look
  → onToolStart   flush pending half-sentence, speech.hold(true)   [existing]
  → tool runs     await opts.onConsent(question)
       useEcho:   mount CameraView (warms up while she is still talking)
                  set drain redirect, then speech.current.end()
                  ← wait for the question to finish PLAYING
                  stopSpeaking(), 300ms teardown, openMic(consent mode)
                  setMode('listening')
       user:      "yeah go ahead"  → readConsent() → 'yes'
  → capture → downscale → cache file → unmount preview → thumbnail
  → tool returns "Photo taken." + a user message carrying the image
  → next lap's first delta opens a FRESH stream → the answer
```

The round epoch never changes, so face choreography survives intact.

## The seam

`AskOptions` gains `onConsent?: (question: string) => Promise<boolean>`, next
to `onToolStart`. It is local-only by construction: Slack never supplies it,
exactly as it never supplies `onDelta`. No capability flag — that is the
existing convention in `src/round/ask.ts`.

Two alternatives were rejected. Having `useEcho` recognise the tool by name in
`onToolStart` puts a tool name inside the speech layer. A module-level consent
broker that the tool imports and `FaceScreen` fills is a hidden global channel
where `AskOptions` is the established explicit seam.

## Modules

`src/vision/`, same pure/effectful split as the rest of the repo.

| file | responsibility | tested |
|---|---|---|
| `consent.ts` | `readConsent(transcript)` → `yes \| no \| unclear`; the fixed fallback questions | pure |
| `photos.ts` | the two-photo window: what to keep, what to evict, the stand-in caption | pure |
| `camera.ts` | capture → downscale → cache file → `{id, uri, dataUrl}`; lazy-required like `stt.ts` | thin |
| `CameraPreview.tsx` | the `CameraView`, mounted only while consent is pending | — |
| `useVision.ts` | camera ref, preview visibility, thumbnail, OS permission, file deletion | — |

`unclear` re-asks once, then gives up. A garbled answer must never read as yes.

## Images in history

```ts
interface Turn { role: Role; content: string; photo?: { id: string; caption: string } }
buildRequest(persona, memories, session, resolve?: (id: string) => string | null)
```

With a live `resolve`, a photo turn becomes content parts (`text` +
`image_url`). With `resolve` returning null — evicted, or a session rehydrated
after relaunch — the caption renders as text instead: `(photo taken earlier: a
USB-C hub)`.

Three things fall out of that indirection, and they are the reason for it:
`buildRequest` stays pure and testable; `estimateTokens` keeps reading
`.content` and adds a flat `IMAGE_TOKENS` per live photo; and **`store.ts`
cannot write base64 to disk**, because a `Turn` only ever holds an id and a
caption. `archiveSession` writes `session.turns` verbatim and needs no change
at all.

The image rides on a **user** message after the tool result — chat completions
will not accept an image in a `tool` message.

## Side column

Preview and thumbnail share one slot in the column's middle gap: roughly 190
design px of slack between LAST SAID and TRANSCRIPT, so nothing else moves.
202×152 at k=1 (`SIDE_COLUMN_W` 250 less 24 padding either side). Live
viewfinder with a recording dot while consent is open, then the captured
frame.

## Costs

- New native dependencies — `expo-camera` and `expo-image-manipulator` — so a
  new EAS dev build. None of this is exercisable in Expo Go or the simulator.
- `NSCameraUsageDescription`, and the OS permission requested lazily on the
  first `camera_look`, *before* the question is spoken, so an OS modal never
  lands on an open mic.
- The tool is absent from the spec list when the native module is missing, the
  way `web_search` is absent without a Tavily key. The list is still built once
  at bring-up; OS permission is deliberately not part of that decision, since
  it would make the list unstable.
- The consent wait must not spend the 30s ask budget: `useAgent` extends its
  abort timer while a gate is open — the same shape, and the same reasoning, as
  `speech.hold` extending `audioOut`'s stall watchdog.

## Measured rather than assumed

- `manipulateAsync` is deprecated; the current API is the `manipulate()`
  context chain, and `resize({width})` alone preserves aspect ratio.
- `CameraView`'s default `mode="picture"` does not require the microphone
  permission, which largely defuses the concern about the camera fighting the
  speech recogniser for the iOS audio session. Still worth a device check.
- `npm run probe:vision` settled the model question, in the style of
  `probe-tools.ts`. **All four presets accept image input**, `o4-mini`
  included, so a mid-session model switch never turns the camera into an
  error. The consent preamble is where they diverge, and it matters more here
  than for any other tool because that sentence is the question the microphone
  opens for: `gpt-5.4-mini` called the tool 3/3 and phrased it as a question
  3/3; `gpt-5.4` 2/3 and 2/2; `gpt-4o-mini` asks "mind if I take a look?" and
  then never calls the tool at all, 0/3; `o4-mini` calls it 3/3 and says
  nothing, 0/3. That last one is why the gate speaks `CONSENT_QUESTION`
  itself — without that branch it opens the mic in silence and waits for
  someone to agree to a question they never heard.

## Risks

`useEcho` is the delicate file — epochs, streams, holds and the follow-up
window, now with a fourth async path through it. Ending a Kokoro stream and
opening a fresh one inside a single round has never been done here, and
`runStream` decides `stopAutomatically` from `inputFinished()` at go-live, so
the second stream needs a look on the device.
