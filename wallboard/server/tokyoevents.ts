// What's on in Tokyo (ASC-35): Tokyo Cheapo's events, published as the
// `tokyo-events` panel. The server owns this panel; a hermes push to it is
// overwritten. hermes reads it back from GET /api/eva/state to pick something
// for the weekend and say so in the `eva` bubble.
//
// Two sources, because neither is enough alone:
// - https://tokyocheapo.com/events/feed/ — one item per event, newest 30, with a
//   neighbourhood category and a photo, but no event dates: pubDate is when the
//   post went up, and the dates sit somewhere in the prose.
// - Each event's own page carries a schema.org `Event` in JSON-LD: startDate,
//   endDate, venue, locality, prices, plus a map widget with lat/lng. Read once
//   per event and kept on disk, so a restart doesn't re-read thirty pages.
// The main feed (tokyocheapo.com/feed/) is articles and listicles, not events.
//
// What the JSON-LD means, as observed on all 30 pages on 2026-11-22:
// - `T00:01` / `T23:59` stand for "no time given" (all-day, or open hours unstated).
// - A multi-day event with real times ("16:00 → 22:00" over two months) gives
//   daily hours, not one continuous run.
// - lowPrice/highPrice are not ordered (low 6600, high 2500), and 0/0 is used both
//   for free events and for ones whose price isn't listed (a theatre run). So a
//   price is only claimed when one is non-zero; 0/0 is "not known", never "free".
// - A date still to be announced is month-only ("2027-10"); such events are left
//   out until the page gains a real date.
// - Some pages contain invalid UTF-8; fetch's text() replaces it harmlessly.
//
// Pure parsing + panel, then a thin poller with its cache, the split weather.ts uses.

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface FeedItem {
  /** Stable id from the post id in the guid ("tc-402638"). */
  id: string;
  title: string;
  url: string;
  /** The post's publish time (ms); a change means the page was edited. */
  published: number;
  /** Categories minus the empty ones, e.g. ["Tokyo", "Shibuya"]. */
  areas: string[];
  image?: string;
}

export interface EventDetails {
  /** "YYYY-MM-DD", Tokyo dates. */
  start: string;
  end: string;
  /** "H:MM" when the page gives a real time (not the 00:01 / 23:59 placeholders). */
  time?: string;
  until?: string;
  venue?: string;
  /** Neighbourhood ("Aomi") and region ("Suburban East Tokyo", "Yokohama and Kanagawa"). */
  locality?: string;
  region?: string;
  lat?: number;
  lon?: number;
  /** Yen. Only when the page lists a non-zero price; see the header for why 0/0 isn't "free". */
  price?: { from: number; to: number };
  summary?: string;
  cancelled?: true;
}

/** One entry in the panel. */
export interface TokyoEvent extends Omit<EventDetails, 'lat' | 'lon' | 'cancelled'> {
  id: string;
  title: string;
  url: string;
  image?: string;
  /** Straight-line km from home, when the page has a map pin. */
  km?: number;
  /** On at some point this coming weekend (or this one, on a Saturday or Sunday). */
  weekend: boolean;
}

// ---- text helpers ---------------------------------------------------------

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', yen: '¥', times: '×', raquo: '»', laquo: '«',
};

/** HTML entities → text. Unknown named entities are left as written. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

const cdata = (s: string) => s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
const tag = (xml: string, name: string) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? decodeEntities(cdata(m[1])).trim() : undefined;
};

// ---- the feed ---------------------------------------------------------------

/** RSS 2.0 as WordPress writes it. Items without a link or post id are skipped. */
export function parseFeed(xml: string): FeedItem[] {
  const out: FeedItem[] = [];
  for (const [, item] of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const url = tag(item, 'link');
    const guid = tag(item, 'guid') ?? '';
    const post = guid.match(/[?&]p=(\d+)/)?.[1];
    const title = tag(item, 'title');
    if (!url || !post || !title) continue;
    const areas = [...item.matchAll(/<category>([\s\S]*?)<\/category>/g)]
      .map(([, c]) => decodeEntities(cdata(c)).trim())
      .filter((c, i, all) => c && all.indexOf(c) === i);
    const image = item.match(/<media:content\s[^>]*url="([^"]+)"/)?.[1];
    out.push({
      id: `tc-${post}`,
      title,
      url,
      published: Date.parse(tag(item, 'pubDate') ?? '') || 0,
      areas,
      ...(image ? { image: decodeEntities(image) } : {}),
    });
  }
  return out;
}

// ---- an event's page ------------------------------------------------------

type Json = Record<string, unknown>;
const obj = (x: unknown): Json | undefined => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Json) : undefined);
const first = (x: unknown): Json | undefined => obj(Array.isArray(x) ? x[0] : x);
const str = (x: unknown): string | undefined => (typeof x === 'string' && x.trim() ? decodeEntities(x.trim()) : undefined);

/** "2026-12-10T18:30+09:00" → { date: "2026-12-10", time: "18:30" | undefined }. */
function splitDate(s: unknown): { date: string; time?: string } | null {
  if (typeof s !== 'string') return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return null; // month-only ("2027-10"): not announced yet
  const hm = m[2] ? `${Number(m[2])}:${m[3]}` : undefined;
  return { date: m[1], time: hm === '0:01' || hm === '23:59' || hm === '0:00' ? undefined : hm };
}

/**
 * The schema.org Event in an event page's JSON-LD, and the map pin. Null when
 * the page has no Event or no full start and end date.
 */
export function parseEventPage(html: string): EventDetails | null {
  let ev: Json | undefined;
  for (const [, raw] of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    try {
      const j = JSON.parse(raw) as unknown;
      const found = (Array.isArray(j) ? j : [j]).map(obj).find((x) => x?.['@type'] === 'Event');
      if (found) { ev = found; break; }
    } catch { /* another site's widget; keep looking */ }
  }
  if (!ev) return null;
  const s = splitDate(ev.startDate);
  const e = splitDate(ev.endDate) ?? s;
  if (!s || !e) return null;

  const place = first(ev.location);
  const addr = obj(place?.address);
  const offers = first(ev.offers);
  const prices = [offers?.lowPrice, offers?.highPrice].map(Number).filter((n) => Number.isFinite(n) && n > 0);
  // The map widget's own JSON: {"lat":"35.626389","lng":"139.783056",…}
  const pin = html.match(/"lat":"?(-?\d+(?:\.\d+)?)"?,\s*"lng":"?(-?\d+(?:\.\d+)?)/);
  const out: EventDetails = { start: s.date, end: e.date < s.date ? s.date : e.date };
  if (s.time) out.time = s.time;
  if (e.time) out.until = e.time;
  const venue = str(place?.name), locality = str(addr?.addressLocality), region = str(addr?.addressRegion);
  if (venue) out.venue = venue;
  if (locality) out.locality = locality;
  if (region) out.region = region;
  if (pin) { out.lat = Number(pin[1]); out.lon = Number(pin[2]); }
  if (prices.length) out.price = { from: Math.min(...prices), to: Math.max(...prices) };
  const summary = str(ev.description);
  if (summary) out.summary = summary;
  if (typeof ev.eventStatus === 'string' && /Cancelled/i.test(ev.eventStatus)) out.cancelled = true;
  return out;
}

// ---- the panel ------------------------------------------------------------

const DAY = 86_400_000;
const dayNum = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY;
const ymdOf = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);

/** The Saturday and Sunday of this weekend: the coming one, or the current one on Sat/Sun. */
export function weekendOf(today: string): { sat: string; sun: string } {
  const n = dayNum(today);
  const wd = new Date(n * DAY).getUTCDay(); // 0 = Sunday
  const sat = wd === 0 ? n - 1 : n + ((6 - wd + 7) % 7);
  return { sat: ymdOf(sat), sun: ymdOf(sat + 1) };
}

/** Great-circle distance in km, one decimal. */
export function kmBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return Math.round(12742 * Math.asin(Math.sqrt(h)) * 10) / 10;
}

/**
 * Everything still on (ending today or later), soonest start first; among
 * events already running, the one ending soonest first. Cancelled ones and
 * ones with no details are left out.
 */
export function eventsPanel(items: { item: FeedItem; details: EventDetails | null }[], today: string, home: { lat: number; lon: number }): TokyoEvent[] {
  const { sat, sun } = weekendOf(today);
  const out: TokyoEvent[] = [];
  for (const { item, details: d } of items) {
    if (!d || d.cancelled || d.end < today) continue;
    const { lat, lon, cancelled: _c, ...rest } = d;
    const e: TokyoEvent = { id: item.id, title: item.title, url: item.url, ...rest, weekend: d.start <= sun && d.end >= sat };
    if (item.image) e.image = item.image;
    if (lat != null && lon != null) e.km = kmBetween(home, { lat, lon });
    out.push(e);
  }
  const key = (e: TokyoEvent) => (e.start > today ? e.start : today);
  return out.sort((a, b) => key(a).localeCompare(key(b)) || a.end.localeCompare(b.end) || a.title.localeCompare(b.title));
}

// ---- poller + cache -------------------------------------------------------

export const FEED_URL = 'https://tokyocheapo.com/events/feed/';

interface Cached { item: FeedItem; details: EventDetails | null; fetchedAt: number }
interface CacheFile { v: 1; events: Record<string, Cached> }

/** Re-read a page this often while its event is still ahead (dates get announced, venues change). */
const REFRESH_MS = 7 * DAY;
/** Polite gap between page reads. */
const PAGE_GAP_MS = 1_500;

const tokyoToday = (at: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

const why = (e: unknown) => (e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e));

/** Which cached events need their page (re)read: new, edited since, or stale and not yet over. */
export function needsPage(c: Cached | undefined, item: FeedItem, now: number, today: string): boolean {
  if (!c) return true;
  if (item.published > c.item.published) return true;
  if (c.details && c.details.end < today) return false;
  return now - c.fetchedAt > REFRESH_MS;
}

/**
 * Poll the feed every `everyMs`, read the page of each event that needs it, and
 * publish the panel whenever it changes (also re-checked hourly, so the
 * weekend flag and finished events roll over without a fetch). Events that fell
 * out of the 30-item feed stay, from the cache, until they end. A failed fetch
 * keeps the last panel up.
 */
export function startTokyoEvents(cacheFile: string, everyMs: number, home: { lat: number; lon: number }, publish: (p: TokyoEvent[]) => void): void {
  let cache: Record<string, Cached> = {};
  let last = '';
  // Absent vs empty: until a feed read has succeeded (now, or before the cache
  // was saved), publish nothing rather than an empty list claiming nothing is on.
  let known = false;

  const recompute = () => {
    if (!known) return;
    const panel = eventsPanel(Object.values(cache), tokyoToday(Date.now()), home);
    const key = JSON.stringify(panel);
    if (key !== last) { last = key; publish(panel); }
  };
  const save = async () => {
    try {
      await mkdir(dirname(cacheFile), { recursive: true });
      const body: CacheFile = { v: 1, events: cache };
      await writeFile(`${cacheFile}.tmp`, JSON.stringify(body));
      await rename(`${cacheFile}.tmp`, cacheFile);
    } catch (e) {
      console.error(`[tokyo-events] cache save failed: ${why(e)}`);
    }
  };
  const get = async (url: string) => {
    const r = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { 'user-agent': 'Mozilla/5.0 (compatible; family-wallboard)' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  };

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const items = parseFeed(await get(FEED_URL));
      const now = Date.now(), today = tokyoToday(now);
      let read = 0, failed = 0;
      for (const item of items) {
        const c = cache[item.id];
        if (!needsPage(c, item, now, today)) { cache[item.id] = { ...c!, item }; continue; }
        if (read + failed) await new Promise((res) => setTimeout(res, PAGE_GAP_MS));
        try {
          cache[item.id] = { item, details: parseEventPage(await get(item.url)), fetchedAt: Date.now() };
          read++;
        } catch (e) {
          failed++;
          console.error(`[tokyo-events] ${item.url} failed: ${why(e)}`);
        }
      }
      // Forget what has ended or has had no readable event for a week, once it is
      // out of the feed too (while it's in, dropping it would only re-read its page).
      const inFeed = new Set(items.map((i) => i.id));
      for (const [id, c] of Object.entries(cache)) {
        if (!inFeed.has(id) && (c.details ? c.details.end < today : now - c.fetchedAt > REFRESH_MS)) delete cache[id];
      }
      console.log(`[tokyo-events] feed ${items.length} items, read ${read} pages${failed ? `, ${failed} failed` : ''}, ${Object.keys(cache).length} cached`);
      known = true;
      await save();
      recompute();
    } catch (e) {
      console.error(`[tokyo-events] feed failed: ${why(e)}`);
    } finally {
      running = false;
    }
  };

  void (async () => {
    try {
      const f = JSON.parse(await readFile(cacheFile, 'utf8')) as CacheFile;
      if (f?.v === 1 && f.events) { cache = f.events; known = true; }
    } catch { /* first run */ }
    recompute();
    await tick();
    setInterval(tick, everyMs).unref();
    setInterval(recompute, 60 * 60_000).unref();
  })();
}
