// The wallboard server: serves the single-page app, holds the board's state in
// one JSON file, and streams every change to open boards over SSE.
//
// No framework and no runtime dependencies — Node runs this TypeScript directly
// (type stripping), so deploy is "copy files, restart".

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply, emptyState, parseChores, reviveState, PANEL_NAME, type Action, type BoardState } from './state.ts';
import { enrollCookie, isBoard, isHermes, keyMatches } from './auth.ts';
import { PhotoLibrary } from './photos.ts';
import { IKEJIRI, startWeather } from './weather.ts';
import { startCalendar } from './calendar.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'web');
const PORT = Number(process.env.PORT ?? 8080);
const DATA = process.env.DATA_FILE ?? join(ROOT, 'data', 'state.json');
const BOARD_TOKEN = process.env.BOARD_TOKEN || undefined;
const HERMES_TOKEN = process.env.HERMES_TOKEN || undefined;
/** Changes on every restart; a board that sees a new one reloads itself, so a deploy reaches the wall. */
const BUILD = process.env.BUILD_ID ?? String(Date.now());

// iCloud shared-album links (Public Website on), comma/space separated. Unset = no photos.
const photos = new PhotoLibrary(
  (process.env.ICLOUD_ALBUMS ?? '').split(/[\s,]+/).filter(Boolean),
  join(dirname(DATA), 'photos'),
  Number(process.env.PHOTO_TARGET ?? 50),
  Number(process.env.PHOTO_SWAP ?? 10),
);
photos.start(60 * 60_000);

// ---- state + persistence ---------------------------------------------------

let state: BoardState = emptyState();
try {
  state = reviveState(JSON.parse(await readFile(DATA, 'utf8')));
} catch {
  // first run, or unreadable — start empty
}

let saving: Promise<void> = Promise.resolve();
function save(s: BoardState): void {
  // Serialized and atomic (tmp + rename): a power cut mid-write leaves the old file.
  saving = saving.then(async () => {
    await mkdir(dirname(DATA), { recursive: true });
    const tmp = `${DATA}.tmp`;
    await writeFile(tmp, JSON.stringify(s));
    await rename(tmp, DATA);
  }).catch((e) => console.error('[state] save failed', e));
}

const clients = new Set<ServerResponse>();
function send(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function dispatch(a: Action): boolean {
  const next = apply(state, a);
  if (!next) return false;
  state = next;
  save(state);
  for (const c of clients) send(c, 'state', state);
  return true;
}

// Keeps idle connections alive through proxies, which drop a silent stream.
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 25_000).unref();

// Real weather (Open-Meteo), published as the `weather` panel. Home by default;
// WEATHER_LAT/WEATHER_LON override, WEATHER=off stops polling (the last panel stays).
if (process.env.WEATHER !== 'off') {
  startWeather(
    Number(process.env.WEATHER_LAT ?? IKEJIRI.lat),
    Number(process.env.WEATHER_LON ?? IKEJIRI.lon),
    15 * 60_000,
    (data) => dispatch({ type: 'panel.set', name: 'weather', data, at: Date.now() }),
  );
}

// The family's day — calendar (CALENDAR_URL, the iCloud published webcal link;
// a secret, never log it) plus the fixed routine — published as `schedule`,
// `tomorrow`, `leave-by` and `bedtime`. Without a URL, the routine alone. DAY=off: dummy.
if (process.env.DAY !== 'off') {
  startCalendar(process.env.CALENDAR_URL || undefined, 15 * 60_000, (name, data) => dispatch({ type: 'panel.set', name, data, at: Date.now() }));
}

// ---- http helpers ----------------------------------------------------------

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function body(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256 * 1024) throw new Error('body too large');
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

async function serveStatic(res: ServerResponse, path: string): Promise<void> {
  const rel = normalize(path === '/' ? '/index.html' : path);
  const file = join(WEB, rel);
  if (!file.startsWith(WEB)) return json(res, 404, { error: 'not found' });
  try {
    const buf = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(buf);
  } catch {
    // SPA fallback: unknown paths get the app, which routes itself.
    if (!extname(rel)) return serveStatic(res, '/');
    json(res, 404, { error: 'not found' });
  }
}

// ---- routes ----------------------------------------------------------------

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://x');
  const { pathname } = url;
  const method = req.method ?? 'GET';

  if (pathname === '/healthz') return json(res, 200, { ok: true, build: BUILD, version: state.version });

  // Enrollment: /?key=<BOARD_TOKEN> sets the cookie, then strips the key from the URL.
  const key = url.searchParams.get('key');
  if (key !== null && method === 'GET') {
    if (!keyMatches(key, BOARD_TOKEN)) return json(res, 403, { error: 'bad key' });
    res.writeHead(302, { 'set-cookie': enrollCookie(key), location: '/' });
    return void res.end();
  }

  // ---- hermes writes (bearer token) ----
  if (pathname.startsWith('/api/eva/')) {
    if (!isHermes(req, HERMES_TOKEN)) return json(res, 401, { error: 'unauthorized' });
    const at = Date.now();

    if (pathname === '/api/eva/state' && method === 'GET') return json(res, 200, state);

    if (pathname === '/api/eva/chores' && method === 'PUT') {
      const chores = parseChores(await body(req));
      if (typeof chores === 'string') return json(res, 400, { error: chores });
      dispatch({ type: 'chores.replace', chores, at });
      return json(res, 200, { ok: true, version: state.version });
    }

    const panel = pathname.match(/^\/api\/eva\/panels\/([^/]+)$/);
    if (panel) {
      const name = panel[1];
      if (!PANEL_NAME.test(name)) return json(res, 400, { error: 'panel name must match ' + PANEL_NAME });
      if (method === 'PUT') {
        const b = (await body(req)) as { data?: unknown } | null;
        if (!b || !('data' in b)) return json(res, 400, { error: 'expected {"data": ...}' });
        dispatch({ type: 'panel.set', name, data: b.data, at });
        return json(res, 200, { ok: true, version: state.version });
      }
      if (method === 'DELETE') {
        dispatch({ type: 'panel.clear', name });
        return json(res, 200, { ok: true, version: state.version });
      }
    }
    return json(res, 404, { error: 'not found' });
  }

  // ---- everything else is the board itself (enrolled cookie) ----
  if (!isBoard(req, BOARD_TOKEN)) {
    res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
    return void res.end('This board is not enrolled. Open /?key=<board token> once on this device.');
  }

  if (pathname === '/api/events' && method === 'GET') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    send(res, 'hello', { build: BUILD });
    send(res, 'state', state);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (pathname === '/api/state' && method === 'GET') return json(res, 200, state);

  if (pathname === '/api/photos' && method === 'GET') return json(res, 200, { photos: photos.list() });

  const photo = pathname.match(/^\/photos\/([^/]+)\.jpg$/);
  if (photo && method === 'GET') {
    const file = photos.file(photo[1]);
    if (!file) return json(res, 404, { error: 'no such photo' });
    try {
      const buf = await readFile(file);
      // Immutable: a photo id never changes content.
      res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400, immutable' });
      return void res.end(buf);
    } catch {
      return json(res, 404, { error: 'no such photo' });
    }
  }

  const chore = pathname.match(/^\/api\/chores\/([^/]+)$/);
  if (chore && method === 'PUT') {
    const id = decodeURIComponent(chore[1]);
    const b = (await body(req)) as { done?: unknown } | null;
    if (typeof b?.done !== 'boolean') return json(res, 400, { error: 'expected {"done": true|false}' });
    if (!state.chores.some((c) => c.id === id)) return json(res, 404, { error: 'no such chore' });
    dispatch({ type: 'chore.set', id, done: b.done, at: Date.now() });
    return json(res, 200, { ok: true, version: state.version });
  }

  if (pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' });
  if (method !== 'GET') return json(res, 405, { error: 'method not allowed' });
  return serveStatic(res, pathname);
}

const server = createServer((req, res) => {
  handle(req, res).catch((e) => {
    const bad = e instanceof SyntaxError || (e instanceof Error && e.message === 'body too large');
    if (!res.headersSent) json(res, bad ? 400 : 500, { error: bad ? e.message : 'internal error' });
    if (!bad) console.error('[http]', e);
  });
});

server.listen(PORT, () => {
  console.log(`[wallboard] listening on :${PORT} (build ${BUILD})`);
  if (!BOARD_TOKEN) console.warn('[wallboard] BOARD_TOKEN unset — board is open (dev only)');
  if (!HERMES_TOKEN) console.warn('[wallboard] HERMES_TOKEN unset — push API is open (dev only)');
});

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => {
    for (const c of clients) c.end();
    server.close();
    await saving;
    process.exit(0);
  });
}
