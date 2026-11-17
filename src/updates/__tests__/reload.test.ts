import { describe, expect, it } from '@jest/globals';
import { QUIET_BEFORE_RELOAD_MS, reloadBlocker, type ReloadInputs } from '../reload';

const NOW = 1_754_600_000_000;

const safe: ReloadInputs = {
  idle: true,
  idleSince: NOW - QUIET_BEFORE_RELOAD_MS,
  now: NOW,
  backlog: 0,
  errandsInFlight: 0,
  overlayOpen: false,
};

describe('reloadBlocker', () => {
  it('allows a reload once the face has been quiet long enough', () => {
    expect(reloadBlocker(safe)).toBeNull();
  });

  it('waits while the face is busy', () => {
    expect(reloadBlocker({ ...safe, idle: false, idleSince: null })).toBe('busy');
  });

  it('treats an idle face with no idle timestamp as busy', () => {
    expect(reloadBlocker({ ...safe, idleSince: null })).toBe('busy');
  });

  it('waits out the quiet period after a conversation ends', () => {
    expect(reloadBlocker({ ...safe, idleSince: NOW - QUIET_BEFORE_RELOAD_MS + 1 })).toBe('settling');
  });

  it('waits while something is queued to be said', () => {
    expect(reloadBlocker({ ...safe, backlog: 1 })).toBe('backlog');
  });

  it('waits while an errand is out, even on a long-quiet face', () => {
    expect(reloadBlocker({ ...safe, errandsInFlight: 1, idleSince: NOW - 10 * QUIET_BEFORE_RELOAD_MS })).toBe(
      'errands',
    );
  });

  it('reports errands ahead of every other blocker', () => {
    expect(
      reloadBlocker({ ...safe, errandsInFlight: 2, idle: false, idleSince: null, backlog: 3, overlayOpen: true }),
    ).toBe('errands');
  });

  it('does not reload out from under someone using the overlay', () => {
    expect(reloadBlocker({ ...safe, overlayOpen: true })).toBe('overlay');
  });
});
