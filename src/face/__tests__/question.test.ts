import { describe, expect, it } from '@jest/globals';
import { endsWithQuestion } from '../question';

describe('endsWithQuestion', () => {
  it.each(['Want me to move it?', 'Shall I?  ', 'You said "tomorrow?"', 'Mind if I take a look?)'])('"%s" asks', (t) => {
    expect(endsWithQuestion(t)).toBe(true);
  });

  it.each(['Done.', 'Did it work? It did.', '', null, undefined])('"%s" does not', (t) => {
    expect(endsWithQuestion(t)).toBe(false);
  });
});
