import { describe, expect, it } from '@jest/globals';
import { speakableFromMrkdwn } from '../speakable';

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

// The local agent loop emits ordinary markdown rather than Slack mrkdwn.
describe('speakableFromMrkdwn — plain markdown from the local agent', () => {
  it('speaks markdown link labels and drops their urls', () => {
    expect(speakableFromMrkdwn('see [the roadmap doc](https://example.com/doc)')).toBe('see the roadmap doc');
  });

  it('keeps the label when a markdown link wraps an angle-bracketed url', () => {
    expect(speakableFromMrkdwn('see [the doc](<https://example.com/doc>)')).toBe('see the doc');
  });

  it('unwraps emphasis inside a markdown link label', () => {
    expect(speakableFromMrkdwn('read [the *final* draft](https://example.com)')).toBe('read the final draft');
  });

  it('drops bare urls', () => {
    expect(speakableFromMrkdwn('it is at https://example.com/doc if you want it')).toBe(
      'it is at if you want it',
    );
  });

  it('strips markdown headings', () => {
    expect(speakableFromMrkdwn('## Tomorrow\nStandup at nine.')).toBe('Tomorrow Standup at nine.');
  });

  it('flattens a markdown list the same way as a mrkdwn one', () => {
    expect(speakableFromMrkdwn('* review the deck\n* book the room')).toBe('review the deck. book the room.');
  });

  it('handles a realistic local-agent reply', () => {
    const input = '**Tomorrow:**\n- 9am standup\n- 11am 1:1\n\nDetails in [your calendar](https://example.com/cal).';
    expect(speakableFromMrkdwn(input)).toBe('Tomorrow: 9am standup. 11am 1:1. Details in your calendar.');
  });
});
