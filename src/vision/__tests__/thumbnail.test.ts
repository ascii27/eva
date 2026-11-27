import { describe, expect, it } from '@jest/globals';
import { THUMBNAIL_AFTER_REPLY_MS, THUMBNAIL_MAX_MS, thumbnailDeadline } from '../thumbnail';

describe('thumbnailDeadline', () => {
  it('falls back to the ceiling when no reply has been spoken', () => {
    expect(thumbnailDeadline(1_000, null)).toBe(1_000 + THUMBNAIL_MAX_MS);
  });

  it('ignores a speech end from before the capture — that was the consent question', () => {
    expect(thumbnailDeadline(1_000, 500)).toBe(1_000 + THUMBNAIL_MAX_MS);
  });

  it('comes down a short grace after the reply ends', () => {
    expect(thumbnailDeadline(1_000, 8_000)).toBe(8_000 + THUMBNAIL_AFTER_REPLY_MS);
  });

  it('never outlives the ceiling, even for a reply that ends late', () => {
    expect(thumbnailDeadline(0, THUMBNAIL_MAX_MS)).toBe(THUMBNAIL_MAX_MS);
  });

  it('counts a reply ending at the capture instant as the answer', () => {
    expect(thumbnailDeadline(1_000, 1_000)).toBe(1_000 + THUMBNAIL_AFTER_REPLY_MS);
  });
});
