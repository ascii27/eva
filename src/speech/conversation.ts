// Pure follow-up window policy for continuous conversation mode — no React.
// useEcho consults decideNext at each round boundary; the window deadline is
// enforced lazily there (the command STT profile self-terminates after ~3s of
// silence, so every empty session end is a natural clock-check point).

export const FOLLOWUP_WINDOW_MS = 10_000;

/** Epoch-ms deadline for the follow-up window; null = no window open. */
export type ConvWindow = number | null;

export type RoundOutcome = 'reply-delivered' | 'empty-listen' | 'ask-failed';

export interface ConvDecision {
  next: 'listen-again' | 'end';
  window: ConvWindow;
}

export function decideNext(outcome: RoundOutcome, now: number, window: ConvWindow): ConvDecision {
  switch (outcome) {
    case 'reply-delivered':
      // Always open/refresh — a window that lapsed during a long think is
      // revived by the reply; mid-exchange the deadline is dormant.
      return { next: 'listen-again', window: now + FOLLOWUP_WINDOW_MS };
    case 'empty-listen':
      // Silence re-listens but never extends the deadline.
      if (window !== null && now < window) return { next: 'listen-again', window };
      return { next: 'end', window: null };
    case 'ask-failed':
      // The error line already speaks; re-opening the mic would loop failures.
      return { next: 'end', window: null };
  }
}
