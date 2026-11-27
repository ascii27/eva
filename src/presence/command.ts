// "Stop watching" (ASC-47). Pure: reads a heard transcript for a request to
// turn presence off or back on.
//
// This is checked on the device before any brain sees the words, so it works
// the same on every brain — including hermes and Slack, which have no device
// tools — and costs no round trip. The promise is that he can turn the camera
// off by voice at any time; that should not depend on a model choosing to call
// a tool.

export type WatchCommand = 'stop' | 'start';

const STOP = [
  /\b(stop|quit|no more)\s+watching\b/,
  /\bstop looking at (me|us)\b/,
  /\bturn (off|out) (the |your )?(camera|presence|watching)\b/,
  /\bturn (the |your )?(camera|presence) off\b/,
  /\bstop (using )?(the |your )?camera\b/,
];

const START = [
  /\b(start|resume|go back to)\s+watching\b/,
  /\byou can watch( me| us)? again\b/,
  /\bturn on (the |your )?(camera|presence|watching)\b/,
  /\bturn (the |your )?(camera|presence) (back )?on\b/,
];

export function readWatchCommand(text: string): WatchCommand | null {
  const t = text.toLowerCase().replace(/[’]/g, "'");
  // "Don't stop watching" is not a stop.
  if (/\bdon'?t stop watching\b/.test(t)) return 'start';
  if (STOP.some((re) => re.test(t))) return 'stop';
  if (START.some((re) => re.test(t))) return 'start';
  return null;
}

/** What she says back. Short: the badge going away is the real confirmation. */
export function watchReply(cmd: WatchCommand, available: boolean): string {
  if (!available) return "I can't watch on this build anyway — the camera module isn't installed.";
  return cmd === 'stop' ? "Okay, I've stopped watching." : "Okay, I'm watching for you again.";
}
