import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaSvg, evaMessage, evaSig, stripEmoji } from './eva.js';

test('stripEmoji drops pictographs, flags, skin tones and joiners, and tidies the gaps', () => {
  assert.equal(stripEmoji('Break a leg tonight 🎻'), 'Break a leg tonight');
  assert.equal(stripEmoji('Pizza 🍕 night!'), 'Pizza night!');
  assert.equal(stripEmoji('Family 👨‍👩‍👧 day 🇯🇵 👍🏽 ✨️'), 'Family day');
  assert.equal(stripEmoji('Rain after 3 — umbrellas by the door!'), 'Rain after 3 — umbrellas by the door!');
});

test('evaMessage: absent or empty means nothing to say', () => {
  assert.equal(evaMessage(undefined), null);
  assert.equal(evaMessage(null), null);
  assert.equal(evaMessage({}), null);
  assert.equal(evaMessage({ text: '   ' }), null);
  assert.equal(evaMessage({ text: '🎉' }), null);          // only emoji: nothing left to say
});

test('evaMessage: the old note shapes still read, mood defaults to happy', () => {
  assert.deepEqual(evaMessage('Library books due'), { text: 'Library books due', sub: null, mood: 'happy', at: null });
  assert.deepEqual(
    evaMessage({ text: 'Grandma comes Saturday!', sub: '🎁 2 sleeps', mood: 'excited', at: '2026-11-16T07:00:00+09:00' }),
    { text: 'Grandma comes Saturday!', sub: '2 sleeps', mood: 'excited', at: '2026-11-16T07:00:00+09:00' },
  );
  assert.equal(evaMessage({ text: 'x', mood: 'sleepy' }).mood, 'happy');   // sleepy is the board's, at night
});

test('evaSig changes with text, sub or time, so a re-push of the same words at a new time re-arrives', () => {
  const a = evaMessage({ text: 'Hi', at: '1' });
  assert.equal(evaSig(a), evaSig(evaMessage({ text: 'Hi', at: '1', mood: 'excited' })));
  assert.notEqual(evaSig(a), evaSig(evaMessage({ text: 'Hi', at: '2' })));
  assert.equal(evaSig(null), '');
});

test('evaSvg: peek drops neck and body, expressions carry their extras, and nothing blurs', () => {
  const full = evaSvg({ expr: 'happy', size: 130 });
  const peek = evaSvg({ expr: 'happy', size: 170, peek: true });
  assert.match(full, /viewBox="0 0 200 192"/);
  assert.match(full, /height="125"/);
  assert.match(peek, /viewBox="0 0 200 150"/);
  assert.match(peek, /width="170" height="128"/);
  assert.doesNotMatch(peek, /y="146"/);                     // no body
  assert.match(evaSvg({ expr: 'excited' }), /eva-sparkles/);
  assert.match(evaSvg({ expr: 'sleepy' }), /class="eva-z"/);
  assert.match(evaSvg({ expr: 'sleepy' }), /#3f8f73/);
  assert.match(evaSvg({ theme: 'dark' }), /eva-t-dark/);
  for (const expr of ['happy', 'excited', 'sleepy']) assert.doesNotMatch(evaSvg({ expr }), /filter|blur/);
});
