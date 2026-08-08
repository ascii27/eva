import { describe, expect, it } from '@jest/globals';
import { decideNext, FOLLOWUP_WINDOW_MS } from '../conversation';

const NOW = 1_754_600_000_000;

describe('decideNext', () => {
  describe('reply-delivered', () => {
    it('opens a fresh follow-up window when none is open', () => {
      expect(decideNext('reply-delivered', NOW, null)).toEqual({
        next: 'listen-again',
        window: NOW + FOLLOWUP_WINDOW_MS,
      });
    });

    it('refreshes an already-open window to the new deadline', () => {
      const old = NOW + 2_000;
      const d = decideNext('reply-delivered', NOW, old);
      expect(d).toEqual({ next: 'listen-again', window: NOW + FOLLOWUP_WINDOW_MS });
      expect(d.window).toBeGreaterThan(old);
    });

    it('revives a window that lapsed during a long think', () => {
      expect(decideNext('reply-delivered', NOW, NOW - 60_000)).toEqual({
        next: 'listen-again',
        window: NOW + FOLLOWUP_WINDOW_MS,
      });
    });
  });

  describe('empty-listen', () => {
    it('ends when no window is open (wake-gated silence)', () => {
      expect(decideNext('empty-listen', NOW, null)).toEqual({ next: 'end', window: null });
    });

    it('re-listens inside the window without extending the deadline', () => {
      const deadline = NOW + 4_000;
      expect(decideNext('empty-listen', NOW, deadline)).toEqual({
        next: 'listen-again',
        window: deadline,
      });
    });

    it('ends at exactly the deadline', () => {
      expect(decideNext('empty-listen', NOW, NOW)).toEqual({ next: 'end', window: null });
    });

    it('ends past the deadline', () => {
      expect(decideNext('empty-listen', NOW, NOW - 1)).toEqual({ next: 'end', window: null });
    });
  });

  describe('ask-failed', () => {
    it('ends the conversation even with an open, unexpired window', () => {
      expect(decideNext('ask-failed', NOW, NOW + 9_000)).toEqual({ next: 'end', window: null });
    });
  });
});
