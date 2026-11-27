// hermes asking to see — pure, no React, no I/O, unit-tested (ASC-43).
//
// hermes has no device tools, so it cannot call `camera_look`. It asks instead:
// a spoken consent question with `[[look]]` on the end (directives.ts), either
// as its answer on the hermes brain or in a Slack message it sends on its own.
// The device then runs the same spoken gate the local brains use, and only an
// audible yes opens the lens. The photo goes back to hermes as the next turn,
// and what hermes says about it is spoken in the same round.
//
// This file is the words on either side of the gate: what the photo turn tells
// hermes, and what Eva says herself when the photo never happens. The second set
// is local on purpose. A refusal, a denied iOS permission or a failed shutter is
// known only to the device, and asking hermes to phrase it would put a full
// agent run in front of a two-word answer.

// Type-only imports: `npm run probe:hermes-vision` loads this file under node,
// whose ESM resolver will not follow an extensionless runtime import.
import type { ContentPart } from '../agent/history';

/** Said when he answers anything but yes. Short: he has just said no. */
export const DECLINED_LINE = "Okay, I won't look.";

/** The build has no camera, or the gate could not be run at all. */
export const NO_CAMERA_LINE = "Actually, I can't use the camera right now.";

/** iOS camera access is off for the app — only Settings can change that. */
export const CAMERA_OFF_LINE = "Actually, I'm not allowed to use the camera on this phone. You can turn it on in Settings.";

/** The shutter failed after a yes. */
export const CAMERA_FAILED_LINE = "Sorry, the camera didn't give me a picture.";

/**
 * Prefixed to the next turn hermes sees after a refusal, so the server-side
 * transcript does not end on an unanswered question. Not sent on its own:
 * that would be a full agent run to deliver one fact.
 */
export const DECLINED_NOTE = '(Device note: Michael said no to the photo, so the camera was not used.)';

/** Longest quote of the original request carried into the photo turn. */
const MAX_QUOTE = 300;

/** Slack mentions and desk tokens are noise inside a quote. */
const NOISE_RE = /<@[^>]+>|\[\[\s*\w+\s*\]\]/g;

function quote(text: string): string {
  const flat = text.replace(NOISE_RE, ' ').replace(/\s+/g, ' ').trim();
  return flat.length <= MAX_QUOTE ? flat : `${flat.slice(0, MAX_QUOTE - 1).trimEnd()}…`;
}

export interface PhotoContext {
  /** What Michael said that led here, when he started it. */
  words?: string | null;
  /** What hermes asked aloud — the consent question, minus its token. */
  asked?: string | null;
}

/**
 * The text that travels with the photo.
 *
 * It carries its own context rather than trusting the transcript, because a
 * Slack-initiated look arrives on the API server with none: the hermes that
 * asked was in a Slack thread, and the one answering is a different door.
 *
 * The room rules are restated here, not left to DESK_PREAMBLE, because they are
 * about *this* image: anything readable in a frame of a desk (a screen, a
 * letter, someone walking past) is exactly what must not be read aloud, and
 * "no storing images by default" is hermes' to keep once the bytes leave the
 * phone.
 */
export function photoText({ words, asked }: PhotoContext): string {
  const lines = ['Here is the photo from the desk camera, taken just now with Michael’s spoken permission.'];
  const said = words ? quote(words) : '';
  const question = asked ? quote(asked) : '';
  if (said) lines.push(`He said: "${said}"`);
  if (question) lines.push(`You asked: "${question}"`);
  lines.push(
    'Answer out loud about what is relevant to that, in a sentence or two.',
    'Anyone in the room can hear you: do not read out anything sensitive you can see, such as documents, screens, messages or details about other people.',
    'Do not save this image or a description of it to memory or anywhere else unless he asks you to. Do not end this reply with [[look]].',
  );
  return lines.join('\n');
}

/** The user message for the photo turn: text first, then the image. */
export function photoContent(context: PhotoContext, dataUrl: string): ContentPart[] {
  return [
    { type: 'text', text: photoText(context) },
    { type: 'image_url', image_url: { url: dataUrl } },
  ];
}

/** Put a pending device note in front of the next thing hermes reads. */
export function withNote(text: string, note: string | null): string {
  return note ? `${note}\n\n${text}` : text;
}
