import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aboutOf, decodeEntities, eventsPanel, forFamily, kmBetween, nearby, needsPage, parseEventPage, parseFeed, weekendOf, type EventDetails, type FeedItem } from './tokyoevents.ts';
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

const item = (id: string, extra: Partial<FeedItem> = {}): FeedItem => ({ id, title: id, url: `https://x/${id}/`, published: 0, areas: ['Tokyo'], ...extra });
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
    { item: item('saturday'), details: ev('2026-11-28', '2026-11-28', { time: '18:00' }), photo: '/event-photos/saturday.jpg?v=0' },
  ], today, IKEJIRI);
  assert.deepEqual(p.map((e) => e.id), ['running-short', 'running-long', 'saturday', 'later']);
  assert.deepEqual(p.map((e) => e.weekend), [true, true, true, false]);
  assert.equal(p[0].km, 1.5);
  assert.equal(p[1].km, undefined);
  assert.equal(p[2].image, '/event-photos/saturday.jpg?v=0');
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

test('feed: the opening paragraph, up to the first subheading', () => {
  const d = parseFeed(fixture('events-feed.xml')).find((i) => i.url.endsWith('/d-league-toyota-arena-tokyo-december/'))!;
  assert.equal(d.about, 'Japan’s professional dance league brings two nights of crew-versus-crew battles to Toyota Arena Tokyo in Odaiba on December 10 and 11, 2026, with shows starting at 6:30 p.m.');
  assert.equal(d.rating, 'nonadult');
  assert.equal(aboutOf('Short.\nWhat to expect\nMore'), 'Short.');
  const long = aboutOf(`${'A long sentence that goes on. '.repeat(20)}\nTail`)!;
  assert.ok(long.length <= 420 && long.endsWith('.'), long);
});

test('page: the photo from the JSON-LD, for posts whose feed item has none', () => {
  assert.match(page('sanrio-puroland-christmas')!.image!, /^https:\/\/cdn\.cheapoguides\.com\/.+puroland.+\.jpg$/);
});

test('family: adult topics are out wherever they appear; drinking only by title', () => {
  const ok = (title: string, summary = '', about = '') => forFamily({ title, about }, { summary });
  assert.equal(ok('Sex of Living Things Exhibition at the National Museum of Nature and Science'), false);
  assert.equal(ok('Art night', 'An adults-only party'), false);
  assert.equal(ok('Burlesque Brunch'), false);
  assert.equal(ok('Craft Beer Festival in Hibiya'), false);
  assert.equal(ok('Sake Tasting Weekend'), false);
  assert.equal(ok('Yokohama Kannai Ballpark Xmas Market', '', 'swaps bats for mulled wine this winter'), true);
  assert.equal(ok('Sanrio Puroland Christmas'), true);
  assert.equal(ok('Barbie Pop-Up'), true); // \bbar\b doesn't match Barbie
  assert.equal(forFamily({ title: 'x', rating: 'adult' }, {}), false);
});

test('nearby: Tokyo only, and within the limit when there is a pin', () => {
  assert.equal(nearby({ areas: ['Tokyo', 'Aomi'] }, { region: 'Suburban East Tokyo' }, 9.4, 25), true);
  assert.equal(nearby({ areas: ['Tokyo', 'Tama'] }, { region: 'Suburban West Tokyo' }, 23.2, 25), true);
  assert.equal(nearby({ areas: ['Tokyo', 'Tama'] }, { region: 'Suburban West Tokyo' }, 23.2, 20), false);
  assert.equal(nearby({ areas: ['Yokohama and Kanagawa', 'Minatomirai'] }, { region: 'Yokohama and Kanagawa' }, 22.4, 25), false);
  assert.equal(nearby({ areas: ['Saitama', 'Kawagoe'] }, {}, undefined, 25), false);
  // Hagiyama: region "Kantō region", but the locality and the feed say Suburban West Tokyo; no pin.
  assert.equal(nearby({ areas: ['Suburban West Tokyo'] }, { locality: 'Suburban West Tokyo', region: 'Kantō region' }, undefined, 25), true);
  assert.equal(nearby({ areas: [] }, {}, 3, 25), false); // nowhere named: not known to be Tokyo
});

test('panel: filtered events are left out; "free" only when no price and the text says so', () => {
  const p = eventsPanel([
    { item: item('far', { areas: ['Yokohama and Kanagawa'] }), details: ev('2026-11-28', '2026-11-28') },
    { item: item('adult', { title: 'Sex of Living Things' }), details: ev('2026-11-28', '2026-11-28') },
    { item: item('free', { about: "It's free, and there's nothing to book." }), details: ev('2026-11-28', '2026-11-28') },
    { item: item('paid', { about: 'Free entry to the garden.' }), details: ev('2026-11-28', '2026-11-28', { price: { from: 300, to: 300 } }) },
    { item: item('unknown'), details: ev('2026-11-28', '2026-11-28') },
  ], '2026-11-25', IKEJIRI);
  assert.deepEqual(p.map((e) => [e.id, e.free ?? null]), [['free', true], ['paid', null], ['unknown', null]]);
});
