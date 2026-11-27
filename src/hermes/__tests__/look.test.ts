import { describe, expect, it } from '@jest/globals';
import { DECLINED_NOTE, photoContent, photoText, withNote } from '../look';

describe('photoText', () => {
  it('quotes what he said and what hermes asked, without tokens or mentions', () => {
    const text = photoText({ words: 'Eva, look at this', asked: '<@U0BOT> Mind if I take a look? [[look]]' });
    expect(text).toContain('He said: "Eva, look at this"');
    expect(text).toContain('You asked: "Mind if I take a look?"');
    const asked = text.split('\n').find((l) => l.startsWith('You asked'))!;
    expect(asked).not.toContain('[[look]]');
    expect(text).not.toContain('<@');
  });

  it('omits context it does not have', () => {
    const text = photoText({ asked: null, words: null });
    expect(text).not.toContain('He said');
    expect(text).not.toContain('You asked');
  });

  it('carries the room rules with every photo', () => {
    const text = photoText({});
    expect(text).toMatch(/do not read out anything sensitive/i);
    expect(text).toMatch(/do not save this image/i);
    // A second request would be a loop of photos off one yes.
    expect(text).toMatch(/do not end this reply with \[\[look\]\]/i);
  });

  it('caps a long quote', () => {
    const text = photoText({ words: 'word '.repeat(200) });
    const quoted = text.split('\n').find((l) => l.startsWith('He said'))!;
    expect(quoted.length).toBeLessThan(320);
    expect(quoted).toContain('…');
  });
});

describe('photoContent', () => {
  it('sends text first, then the image', () => {
    const parts = photoContent({ words: 'what is this' }, 'data:image/jpeg;base64,AAAA');
    expect(parts).toHaveLength(2);
    expect(parts[0].type).toBe('text');
    expect(parts[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } });
  });
});

describe('withNote', () => {
  it('prefixes a pending note and leaves the text alone without one', () => {
    expect(withNote('hello', null)).toBe('hello');
    expect(withNote('hello', DECLINED_NOTE)).toBe(`${DECLINED_NOTE}\n\nhello`);
  });
});
