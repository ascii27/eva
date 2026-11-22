import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeEntities, eventsPanel, kmBetween, needsPage, parseEventPage, parseFeed, weekendOf, type EventDetails, type FeedItem } from './tokyoevents.ts';
import { IKEJIRI } from './weather.ts';

// Cut from the real feed and pages on 2026-11-22 (see the header of tokyoevents.ts).
const fixture = (name: string) => readFileSync(new URL(`./fixtures/tokyocheapo-${name}`, import.meta.url), 'utf8');
const page = (slug: string) => parseEventPage(fixture(`${slug}.html`));

test('feed: one item per event, ids from the post id, empty categories dropped', () => {
  const items = parseFeed(fixture('events-feed.xml'));
  assert.equal(items.length, 4);
  const d = items.find((i) => i.url.endsWith('/d-league-toyota-arena-tokyo-december/'))!;
  assert.equal(d.id, 'tc-402638');
  assert.equal(d.title, 'D.League: Japan’s Pro Dance League Live at Toyota Arena Tokyo');
  assert.deepEqual(d.areas, ['Tokyo', 'Aomi']);
  assert.match(d.image!, /^https:\/\/cdn\.cheapoguides\.com\/.+\.jpg$/);
  assert.equal(d.published, Date.parse('Fri, 20 Nov 2026 03:59:09 +0000'));
  const h = items.find((i) => i.url.includes('hagiyama'))!;
  assert.deepEqual(h.areas, ['Suburban West Tokyo']); // the feed has an empty <category> before it
});

test('page: dates, times, venue, map pin and price from the JSON-LD', () => {
  assert.deepEqual(page('d-league-toyota-arena-tokyo-december'), {
    start: '2026-12-10', end: '2026-12-11', time: '18:30', until: '21:15',
    venue: 'Toyota Arena Tokyo', locality: 'Aomi', region: 'Suburban East Tokyo',
    lat: 35.626389, lon: 139.783056,
    price: { from: 8800, to: 8800 }, // lowPrice 8800, highPrice 0
    summary: "Watch D.League, Japan's professional dance league, live at Toyota Arena Tokyo in Odaiba on December 10 and 11, 2026. Doors 5:30 p.m., tickets 8,800 ye",
  });
});

test('page: 00:01 and 23:59 are "no time"; unordered prices are put in order', () => {
  const p = page('sanrio-puroland-christmas')!;
  assert.equal(p.start, '2026-11-06');
  assert.equal(p.end, '2026-12-25');
  assert.equal(p.time, undefined);
  assert.equal(p.until, undefined);
  assert.deepEqual(p.price, { from: 2500, to: 6600 }); // lowPrice 6600, highPrice 2500
});

test('page: 0/0 prices are not known rather than free; no map pin, no lat/lon', () => {
  const p = page('hagiyama-park-autumn-light-up')!;
  assert.equal(p.price, undefined);
  assert.equal(p.lat, undefined);
  assert.equal(p.time, '17:30');
});

test('page: a month-only date (not announced yet) is no event', () => {
  assert.equal(page('yakiimo-fes-tokyo'), null);
});

test('page: no Event, or broken JSON-LD, is null rather than a throw', () => {
  assert.equal(parseEventPage('<html></html>'), null);
  assert.equal(parseEventPage('<script type="application/ld+json">{nope</script>'), null);
  assert.equal(parseEventPage('<script type="application/ld+json">{"@type":"Article"}</script>'), null);
});

test('entities: numeric, hex and named', () => {
  assert.equal(decodeEntities('Japan&#8217;s &amp; &#x2013; &ndash; &rsquo; &bogus;'), 'Japan’s & – – ’ &bogus;');
});

test('weekend: the coming Saturday and Sunday, or the current ones at the weekend', () => {
  assert.deepEqual(weekendOf('2026-11-18'), { sat: '2026-11-21', sun: '2026-11-22' }); // Wednesday
  assert.deepEqual(weekendOf('2026-11-21'), { sat: '2026-11-21', sun: '2026-11-22' }); // Saturday
  assert.deepEqual(weekendOf('2026-11-22'), { sat: '2026-11-21', sun: '2026-11-22' }); // Sunday
  assert.deepEqual(weekendOf('2026-11-23'), { sat: '2026-11-28', sun: '2026-11-29' }); // Monday
});

test('km: Ikejiri to Toyota Arena Tokyo is about 10 km', () => {
  const km = kmBetween(IKEJIRI, { lat: 35.626389, lon: 139.783056 });
  assert.ok(km > 9 && km < 10, String(km));
});

const item = (id: string, extra: Partial<FeedItem> = {}): FeedItem => ({ id, title: id, url: `https://x/${id}/`, published: 0, areas: [], ...extra });
const ev = (start: string, end: string, extra: Partial<EventDetails> = {}): EventDetails => ({ start, end, ...extra });

test('panel: ended, cancelled and unreadable events are left out; running ones sort as today', () => {
  const today = '2026-11-25'; // Wednesday
  const p = eventsPanel([
    { item: item('ended'), details: ev('2026-11-01', '2026-11-24') },
    { item: item('cancelled'), details: ev('2026-12-01', '2026-12-01', { cancelled: true }) },
    { item: item('unreadable'), details: null },
    { item: item('later'), details: ev('2026-12-10', '2026-12-11') },
    { item: item('running-long'), details: ev('2026-11-01', '2027-01-31') },
    { item: item('running-short'), details: ev('2026-11-20', '2026-11-29', { lat: 35.65, lon: 139.7 }) },
    { item: item('saturday', { image: 'https://i/x.jpg' }), details: ev('2026-11-28', '2026-11-28', { time: '18:00' }) },
  ], today, IKEJIRI);
  assert.deepEqual(p.map((e) => e.id), ['running-short', 'running-long', 'saturday', 'later']);
  assert.deepEqual(p.map((e) => e.weekend), [true, true, true, false]);
  assert.equal(p[0].km, 1.5);
  assert.equal(p[1].km, undefined);
  assert.equal(p[2].image, 'https://i/x.jpg');
  assert.equal(p[2].time, '18:00');
  assert.ok(!('lat' in p[0]) && !('cancelled' in p[0]));
});

test('needsPage: new, edited, or a week stale while still ahead', () => {
  const now = Date.parse('2026-11-22T00:00:00Z');
  const it = item('a', { published: 100 });
  assert.equal(needsPage(undefined, it, now, '2026-11-22'), true);
  const fresh = { item: it, details: ev('2026-12-01', '2026-12-02'), fetchedAt: now - 86_400_000 };
  assert.equal(needsPage(fresh, it, now, '2026-11-22'), false);
  assert.equal(needsPage(fresh, item('a', { published: 200 }), now, '2026-11-22'), true);
  assert.equal(needsPage({ ...fresh, fetchedAt: now - 8 * 86_400_000 }, it, now, '2026-11-22'), true);
});
