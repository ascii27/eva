// The transport contract for one spoken round, and its latency formatting —
// no React, unit-tested.
//
// `useEcho` choreographs a round without knowing where the answer comes from:
// it calls `ask(text)` and switches on the AskResult kind. Two transports
// implement it — Slack (src/slack/useSlack.ts, the remote hermes-agent) and the
// local agent loop (src/agent/useAgent.ts) — which is why this lives here
// rather than inside either one.

export interface RoundMarks {
  wokeAt?: number;
  heardAt: number;
  postedAt?: number;
  replyAt?: number;
  spokeAt?: number;
}

/**
 * `timeout` and `offline` carry optional copy because the right thing to say
 * out loud is transport-specific ("Eva hasn't answered yet, her reply will show
 * up in the transcript" only makes sense for the async Slack path). `useEcho`
 * falls back to generic lines when a transport doesn't supply one.
 *
 * `error.message` is spoken by nobody — it reaches the transcript via onIssue,
 * so each transport prefixes its own source (`slack · …`, `agent · …`).
 */
export type AskResult =
  | { kind: 'reply'; raw: string; speakable: string; postedAt: number; replyAt: number }
  | { kind: 'timeout'; postedAt: number; message?: string }
  | { kind: 'offline'; message?: string }
  | { kind: 'error'; message: string };

/**
 * Per-round options a transport may honour. A transport that cannot stream
 * simply never calls `onDelta`, which is what lets useEcho decide how to
 * deliver the reply without asking the transport what it supports.
 */
export interface AskOptions {
  /** Called with each fragment of the reply as it arrives, in order. */
  onDelta?: (text: string) => void;
  /**
   * A tool is about to run, so the reply will pause here. Anything streamed
   * before this was the preamble Eva speaks to say what she is doing; the
   * answer itself arrives after. Transports without tools never call it.
   */
  onToolStart?: (names: string[]) => void;
  /**
   * Ask the room for permission out loud and wait for the answer. Resolves
   * true only on an audible yes — silence, a garbled transcript, a cancelled
   * round and a missing handler are all false, because the one thing this must
   * never do is let a tool act on consent nobody gave.
   *
   * When the model emitted a preamble, that already asked and this only waits
   * for the answer; when it didn't, the gate speaks a question itself.
   * `question` is that fallback, and only tools whose gate is about something
   * variable pass one — the camera's is fixed wording, but an action has to be
   * read back or he is agreeing to something unnamed.
   *
   * Local-only in practice, and supplied rather than advertised: a transport
   * that cannot run a spoken gate simply omits it, and the tool that needs one
   * declines instead. Same shape as `onDelta` — see the note above about not
   * having a capability flag.
   */
  onConsent?: (question?: string) => Promise<boolean>;
}

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function formatLatency(marks: RoundMarks): string {
  const parts = ['latency'];
  if (marks.postedAt !== undefined) parts.push(`post ${secs(marks.postedAt - marks.heardAt)}`);
  if (marks.postedAt !== undefined && marks.replyAt !== undefined) {
    parts.push(`eva ${secs(marks.replyAt - marks.postedAt)}`);
    if (marks.spokeAt !== undefined) {
      parts.push(`total ${secs(marks.spokeAt - (marks.wokeAt ?? marks.heardAt))}`);
    }
  } else {
    parts.push('no reply');
  }
  return parts.join(' · ');
}
