import { describe, expect, it } from '@jest/globals';
import { formatUsage } from '../openai';

describe('formatUsage', () => {
  it('reports prompt and completion tokens', () => {
    expect(formatUsage({ promptTokens: 412, cachedTokens: 0, completionTokens: 89 })).toBe('412 in · 89 out');
  });

  it('calls out the cached prefix when there was one', () => {
    expect(formatUsage({ promptTokens: 412, cachedTokens: 256, completionTokens: 89 })).toBe(
      '412 in (256 cached) · 89 out',
    );
  });

  it('omits the cached note rather than printing a zero', () => {
    expect(formatUsage({ promptTokens: 900, cachedTokens: 0, completionTokens: 12 })).not.toContain('cached');
  });
});
