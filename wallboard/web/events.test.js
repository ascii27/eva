import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardEvents, cardMeta, dateLine, dayChoices, dayLabel, defaultDay, hoursLine, page, placeLine, planState, priceLine, priceShort, weekendDays, weekendOf } from './events.js';

const WED = '2026-11-25';
const ev = (start, end, extra = {}) => ({ id: `${start}-${end}`, title: 't', url: 'u', start, end, weekend: false, ...extra });

test('labels: days, ranges, and events already running', () => {
  assert.equal(dayLabel('2026-11-28'), 'Sat 28 Nov');
  assert.equal(dateLine(ev('2026-12-01', '2026-12-01'), WED), 'Tue 1 Dec');
  assert.equal(dateLine(ev('2026-11-28', '2026-12-13'), WED), 'Sat 28 Nov – Sun 13 Dec');
  assert.equal(dateLine(ev('2026-11-06', '2026-12-25'), WED), 'Until Fri 25 Dec');
});

test('hours: a single day is a span; several days are each day\'s hours; none is null', () => {
  assert.equal(hoursLine(ev('2026-12-10', '2026-12-10', { time: '18:30', until: '21:15' })), '18:30–21:15');
  assert.equal(hoursLine(ev('2026-11-28', '2026-12-13', { time: '17:30', until: '20:30' })), '17:30–20:30 each day');
  assert.equal(hoursLine(ev('2026-12-01', '2026-12-01', { time: '18:30' })), 'From 18:30');
  assert.equal(hoursLine(ev('2026-12-01', '2026-12-01')), null);
});

test('price: a range, one price, free, or said to be unknown', () => {
  assert.equal(priceShort({ price: { from: 800, to: 1500 } }), '¥800–1,500');
  assert.equal(priceShort({ price: { from: 2600, to: 2600 } }), '¥2,600');
  assert.equal(priceShort({ free: true }), 'Free');
  assert.equal(priceShort({}), null);
  assert.equal(priceLine({}), 'Price not listed');
});

test('weekend: which of this weekend\'s days, from today on', () => {
  assert.deepEqual(weekendOf(WED), { sat: '2026-11-28', sun: '2026-11-29' });
  assert.equal(weekendDays(ev('2026-11-20', '2026-12-20'), WED), 'Sat & Sun');
  assert.equal(weekendDays(ev('2026-11-29', '2026-11-29'), WED), 'Sun');
  assert.equal(weekendDays(ev('2026-12-01', '2026-12-05'), WED), null);
  // On Sunday, Saturday has gone.
  assert.equal(weekendDays(ev('2026-11-20', '2026-12-20'), '2026-11-29'), 'Sun');
});

test('card meta and place lines', () => {
  assert.equal(cardMeta(ev('2026-11-21', '2026-11-29', { km: 8, price: { from: 800, to: 1500 } }), WED), 'Sat & Sun · 8 km · ¥800–1,500');
  assert.equal(cardMeta(ev('2026-12-01', '2026-12-01'), WED), 'Tue 1 Dec');
  assert.equal(placeLine({ venue: 'Toyota Arena Tokyo', locality: 'Aomi', km: 9.4 }), 'Toyota Arena Tokyo · Aomi · 9 km from home');
  assert.equal(placeLine({ venue: 'Akasaka', locality: 'Akasaka' }), 'Akasaka');
  assert.equal(placeLine({}), null);
});

test('day choices: every day for a short run; weekends for a long one; never a past day', () => {
  assert.deepEqual(dayChoices(ev('2026-12-10', '2026-12-11'), WED), ['2026-12-10', '2026-12-11']);
  assert.deepEqual(dayChoices(ev('2026-11-20', '2026-11-26'), WED), ['2026-11-25', '2026-11-26']);
  const long = dayChoices(ev('2026-11-06', '2027-01-31'), WED);
  assert.deepEqual(long, ['2026-11-28', '2026-11-29', '2026-12-05', '2026-12-06', '2026-12-12', '2026-12-13']);
  // A long weekday-only stretch still offers two days.
  assert.deepEqual(dayChoices(ev('2027-03-01', '2027-03-05'), WED).length, 5);
  assert.deepEqual(dayChoices(ev('2026-11-01', '2026-11-24'), WED), []);
  assert.equal(defaultDay(long, WED), '2026-11-28');
  assert.equal(defaultDay(['2026-12-10', '2026-12-11'], WED), '2026-12-10');
  assert.equal(defaultDay([], WED), null);
});

test('card: this weekend, planned first; otherwise what\'s coming; nothing for no list', () => {
  const a = ev('2026-11-28', '2026-11-28', { id: 'a' });
  const b = ev('2026-11-29', '2026-11-29', { id: 'b' });
  const c = ev('2026-12-10', '2026-12-10', { id: 'c' });
  const card = cardEvents([a, b, c], [{ id: 'b', want: 'add', status: 'done', day: '2026-11-29' }], WED);
  assert.equal(card.title, 'This weekend');
  assert.deepEqual(card.items.map((e) => e.id), ['b', 'a']);
  assert.deepEqual(cardEvents([c], [], WED), { title: 'Coming up in Tokyo', items: [c] });
  assert.equal(cardEvents([], [], WED), null);
  assert.equal(cardEvents(undefined, [], WED), null);
});

test('plan states', () => {
  const p = (want, status, note) => ({ id: 'x', day: '2026-11-28', want, status, ...(note ? { note } : {}) });
  assert.equal(planState(undefined), null);
  assert.deepEqual(planState(p('add', 'pending')), { state: 'adding', label: 'Asking Eva to add it', day: 'Sat 28 Nov' });
  assert.equal(planState(p('add', 'done')).label, 'On the calendar · Sat 28 Nov');
  assert.equal(planState(p('add', 'failed', 'calendar unreachable')).label, 'Eva couldn’t add it: calendar unreachable');
  assert.equal(planState(p('remove', 'pending')).state, 'removing');
  assert.equal(planState(p('remove', 'failed')).label, 'Eva couldn’t take it off');
});

test('pages clamp', () => {
  const list = Array.from({ length: 19 }, (_, i) => i);
  assert.deepEqual(page(list, 0), { items: [0, 1, 2, 3, 4, 5, 6, 7], page: 0, pages: 3 });
  assert.deepEqual(page(list, 9).items, [16, 17, 18]);
  assert.deepEqual(page([], 0), { items: [], page: 0, pages: 1 });
});
