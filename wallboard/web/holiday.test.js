import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BIG, DECOR, HERO_MOVE, badgeUrl, garlandSvg, heroHtml, holidayOn, motifSvg, zodiac } from './holiday.js';

test('holidayOn finds the big holidays on their own day only', () => {
  assert.equal(holidayOn(2027, 1, 1), 'new-year');
  assert.equal(holidayOn(2027, 2, 14), 'valentine');
  assert.equal(holidayOn(2026, 10, 31), 'halloween');
  assert.equal(holidayOn(2026, 12, 25), 'christmas');
  assert.equal(holidayOn(2026, 12, 24), null);
  assert.equal(holidayOn(2026, 1, 2), null);
});

test('Thanksgiving is the fourth Thursday of November', () => {
  assert.equal(holidayOn(2026, 11, 26), 'thanksgiving');
  assert.equal(holidayOn(2027, 11, 25), 'thanksgiving');
  assert.equal(holidayOn(2026, 11, 19), null);
  assert.equal(holidayOn(2026, 11, 27), null);
});

test('zodiac follows the twelve-year cycle, 2020 the Rat', () => {
  assert.deepEqual(zodiac(2020), { kanji: '子', name: 'Rat' });
  assert.deepEqual(zodiac(2026), { kanji: '午', name: 'Horse' });
  assert.deepEqual(zodiac(2027), { kanji: '未', name: 'Sheep' });
  assert.deepEqual(zodiac(2031), { kanji: '亥', name: 'Boar' });
  assert.deepEqual(zodiac(2019), { kanji: '亥', name: 'Boar' });
});

test('every big holiday has decor and a featured character', () => {
  for (const k of BIG) {
    assert.ok(DECOR[k], k);
    assert.ok(HERO_MOVE[k], k);
    assert.match(garlandSvg(k), /^<svg width="1920" height="78"/);
    assert.match(badgeUrl(k), /^url\("data:image\/svg\+xml,/);
    assert.match(heroHtml(k, 2027), new RegExp(`class="wb-hero ${HERO_MOVE[k]}"`));
  }
});

test('the garland hangs one motif per swag', () => {
  assert.equal(garlandSvg('christmas').match(/<svg x=/g).length, 12);
});

test('ordinary kinds get nothing', () => {
  assert.equal(garlandSvg('birthday'), '');
  assert.equal(badgeUrl(null), '');
  assert.equal(heroHtml('birthday', 2027), '');
  assert.equal(motifSvg('nope', '#000'), '');
});

test("New Year's character is the coming year's zodiac sign", () => {
  const h = heroHtml('new-year', 2027);
  assert.match(h, /未/);
  assert.match(h, /Year of the Sheep/);
});
