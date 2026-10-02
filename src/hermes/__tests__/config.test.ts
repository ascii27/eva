import { describe, expect, it } from '@jest/globals';
import { BUNDLE_SESSION_ID, SESSION_KEY, brainSessionId } from '../config';

describe('brainSessionId', () => {
  const noon = Date.UTC(2026, 9, 2, 12, 0, 0);

  it('is stable for one session, so a follow-up lands in the same transcript', () => {
    // Server-side history is keyed on this. A new id mid-conversation would
    // make Eva forget the previous turn.
    expect(brainSessionId(noon)).toBe(brainSessionId(noon));
  });

  it('is a new transcript for a new session', () => {
    expect(brainSessionId(noon)).not.toBe(brainSessionId(noon + 1_000));
  });

  it('is not the bundle transcript', () => {
    // A refresh is machinery; spoken turns are the actual conversation. Several
    // hundred refreshes a day landing in it would bury him.
    expect(brainSessionId(noon)).not.toBe(BUNDLE_SESSION_ID);
  });

  it('is not the long-term memory scope, which spans every session', () => {
    expect(brainSessionId(noon)).not.toBe(SESSION_KEY);
  });

  it('carries no character the server rejects in a header', () => {
    // Documented limits on X-Hermes-Session-Id: at most 256 chars, and \r, \n
    // and \x00 are rejected outright.
    const id = brainSessionId(noon);
    expect(id.length).toBeLessThanOrEqual(256);
    expect(id).toMatch(/^[\x20-\x7e]+$/);
    expect(id).not.toMatch(/[\r\n\x00]/);
  });
});
