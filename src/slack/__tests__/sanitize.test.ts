import { describe, expect, it } from '@jest/globals';
import { isToolEcho, toolLabelFromEcho } from '../sanitize';

describe('isToolEcho', () => {
  it('flags a terminal echo whose only speech is a label', () => {
    expect(isToolEcho(":computer: terminal\n```\nTZ=Asia/Tokyo date '+%Y-%m-%d %H:%M'\n```")).toBe(true);
  });

  it('flags a bare code block', () => {
    expect(isToolEcho('```\nconst x = 1;\n```')).toBe(true);
  });

  it('flags emoji-labeled tool traces regardless of length', () => {
    expect(isToolEcho(':books: skill_view: "hermes-agent"\n:computer: terminal\n```\nTZ=Asia/Tokyo date\n```')).toBe(
      true,
    );
  });

  it('flags emoji-labeled gateway status notices', () => {
    expect(isToolEcho(':warning: Gateway restarting — Your current task will be interrupted.')).toBe(true);
    expect(isToolEcho(':recycle: Gateway online — Hermes is back and ready.')).toBe(true);
  });

  it('flags a message that sanitizes to nothing', () => {
    expect(isToolEcho(':tada:')).toBe(true);
  });

  it('keeps a real answer', () => {
    expect(isToolEcho('It’s 2026-08-07 23:29:32 JST in Tokyo right now.')).toBe(false);
  });

  it('keeps a short answer with no code fence', () => {
    expect(isToolEcho('Done.')).toBe(false);
  });

  it('keeps a substantial answer that happens to include code', () => {
    expect(isToolEcho('Run this in your shell to fix the clock:\n```\nsudo sntp -sS time.apple.com\n```')).toBe(false);
  });

});

describe('toolLabelFromEcho', () => {
  it('extracts the label after the emoji code', () => {
    expect(toolLabelFromEcho(':computer: terminal\n```ls -la```')).toBe('terminal');
  });

  it('extracts underscored labels and drops the trailing colon', () => {
    expect(toolLabelFromEcho(':books: skill_view: slack-search')).toBe('skill_view');
  });

  it('lowercases the label', () => {
    expect(toolLabelFromEcho(':warning: Gateway restarting')).toBe('gateway');
  });

  it('tolerates leading whitespace', () => {
    expect(toolLabelFromEcho('  :computer: terminal')).toBe('terminal');
  });

  it('returns null for plain prose', () => {
    expect(toolLabelFromEcho('The Q3 doc is filed under Platform Planning.')).toBeNull();
  });

  it('returns null for an emoji code with nothing after it', () => {
    expect(toolLabelFromEcho(':computer:')).toBeNull();
  });
});
