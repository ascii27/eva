import { describe, expect, it } from '@jest/globals';
import { isToolEcho, speakableFromMrkdwn } from '../sanitize';

describe('speakableFromMrkdwn', () => {
  it('passes plain conversational text through untouched', () => {
    expect(speakableFromMrkdwn('The Q3 doc is filed under Platform Planning.')).toBe(
      'The Q3 doc is filed under Platform Planning.',
    );
  });

  it('unwraps bold, italic, and strikethrough', () => {
    expect(speakableFromMrkdwn('this is *really* important')).toBe('this is really important');
    expect(speakableFromMrkdwn('done _yesterday_ evening')).toBe('done yesterday evening');
    expect(speakableFromMrkdwn('the ~old~ new plan')).toBe('the old new plan');
  });

  it('unwraps inline code', () => {
    expect(speakableFromMrkdwn('run `npm test` first')).toBe('run npm test first');
  });

  it('drops fenced code blocks entirely', () => {
    expect(speakableFromMrkdwn('here:\n```\nconst x = 1;\n```\ndone')).toBe('here: done');
  });

  it('drops user mentions', () => {
    expect(speakableFromMrkdwn('<@U0AAAAAAA> the meeting moved')).toBe('the meeting moved');
    expect(speakableFromMrkdwn('ask <@U0AAAAAAA|michael> about it')).toBe('ask about it');
  });

  it('drops special mentions', () => {
    expect(speakableFromMrkdwn('<!here> standup in five')).toBe('standup in five');
    expect(speakableFromMrkdwn('<!channel> heads up')).toBe('heads up');
  });

  it('speaks link labels and drops bare urls', () => {
    expect(speakableFromMrkdwn('see <https://example.com/doc|the roadmap doc>')).toBe('see the roadmap doc');
    expect(speakableFromMrkdwn('link: <https://example.com/doc>')).toBe('link:');
  });

  it('speaks channel references by name', () => {
    expect(speakableFromMrkdwn('posted in <#C012345|general>')).toBe('posted in #general');
  });

  it('flattens bullet lists into sentences', () => {
    expect(speakableFromMrkdwn('• review the deck\n• book the room')).toBe('review the deck. book the room.');
    expect(speakableFromMrkdwn('- first thing\n- second thing')).toBe('first thing. second thing.');
    expect(speakableFromMrkdwn('1. alpha\n2. beta')).toBe('alpha. beta.');
  });

  it('keeps existing terminal punctuation when flattening lines', () => {
    expect(speakableFromMrkdwn('• is it ready?\n• ship it!')).toBe('is it ready? ship it!');
  });

  it('strips blockquote markers', () => {
    expect(speakableFromMrkdwn('> quoted thing\nreply')).toBe('quoted thing. reply');
  });

  it('drops emoji codes', () => {
    expect(speakableFromMrkdwn('done :tada: nicely :thumbsup:')).toBe('done nicely');
  });

  it('does not mistake clock times for emoji codes', () => {
    expect(speakableFromMrkdwn('It’s 23:52:26 JST in Tokyo right now.')).toBe(
      'It’s 23:52:26 JST in Tokyo right now.',
    );
  });

  it('unescapes html entities', () => {
    expect(speakableFromMrkdwn('research &amp; development &lt;3 &gt;')).toBe('research & development <3 >');
  });

  it('collapses newlines and runs of whitespace', () => {
    expect(speakableFromMrkdwn('one\n\ntwo   three')).toBe('one two three');
  });

  it('handles a realistic Eva-style reply', () => {
    const input = '*Tomorrow:*\n• 9am — standup\n• 11am — 1:1 with <@U0AAAAAAA>\nDetails in <https://example.com/cal|your calendar> :calendar:';
    expect(speakableFromMrkdwn(input)).toBe('Tomorrow: 9am — standup. 11am — 1:1 with. Details in your calendar');
  });
});

describe('isToolEcho', () => {
  it('flags a terminal echo whose only speech is a label', () => {
    expect(isToolEcho(":computer: terminal\n```\nTZ=Asia/Tokyo date '+%Y-%m-%d %H:%M'\n```")).toBe(true);
  });

  it('flags a bare code block', () => {
    expect(isToolEcho('```\nconst x = 1;\n```')).toBe(true);
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
