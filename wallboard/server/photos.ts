// Memories: photos from iCloud shared albums ("Public Website" turned on).
//
// Apple's shared-album web feed is undocumented, so everything we rely on is
// listed here, measured against a real album on 2026-11-15:
//   POST https://p01-sharedstreams.icloud.com/<token>/sharedstreams/webstream
//        body {"streamCtag":null}
//     → 330 + {"X-Apple-MMe-Host": "pNN-sharedstreams.icloud.com"} the first
//       time; repeat on that host for the album: streamName + photos[] (each
//       with photoGuid, caption, width/height, derivatives{size: {checksum,…}},
//       mediaAssetType "video" for videos).
//   POST …/webasseturls  body {"photoGuids": [...]}
//     → items{checksum: {url_location, url_path}} — signed URLs that EXPIRE IN
//       ~20 MINUTES, which is why the server downloads its own copies rather
//       than handing the board Apple's links.
//
// Deliberately small: a rotating set of PHOTO_TARGET photos lives on disk, and
// every hour a few are swapped for new pseudo-random picks. Repeats are fine.
// Each is pre-sized on the way in (DESIGN.md: landscape 1920 wide, portrait
// 1080 tall, JPEG ~80%) so Silk never decodes a full camera file.

import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

export interface PhotoEntry {
  id: string;
  /** Checksum of the derivative we download — the key webasseturls answers with. */
  checksum: string;
  caption: string;
  album: number;
}

export interface CachedPhoto {
  id: string;
  caption: string;
  /** Pixel size of the stored (resized, upright) file; the board picks a layout from the ratio. */
  w: number;
  h: number;
}

/** Bumped when stored files change shape, so an old cache is re-fetched rather than mixed in. */
const CACHE_VERSION = 2;

/** The token is everything after '#', minus any ';…' suffix. */
export function albumToken(url: string): string | null {
  const hash = url.split('#')[1];
  const token = hash?.split(';')[0]?.trim();
  return token && /^[A-Za-z0-9_-]+$/.test(token) ? token : null;
}

interface StreamPhoto {
  photoGuid?: string;
  caption?: string;
  width?: string;
  height?: string;
  mediaAssetType?: string;
  derivatives?: Record<string, { checksum?: string; width?: string }>;
}

/** Stills of any orientation (the board lays portraits out in pairs); videos would need a player. */
export function entriesFrom(stream: { streamName?: string; photos?: StreamPhoto[] }, album: number): PhotoEntry[] {
  const out: PhotoEntry[] = [];
  for (const p of stream.photos ?? []) {
    if (p.mediaAssetType === 'video' || !p.photoGuid || !p.derivatives) continue;
    const best = Object.values(p.derivatives).reduce<{ checksum?: string; width?: string } | null>(
      (a, d) => (!a || Number(d.width) > Number(a.width) ? d : a),
      null,
    );
    if (!best?.checksum) continue;
    out.push({ id: p.photoGuid, checksum: best.checksum, caption: p.caption?.trim() || stream.streamName || '', album });
  }
  return out;
}

/**
 * What to drop and what to fetch this cycle. Pure; `rand` is injectable for tests.
 * Drops anything removed from the albums, then `swap` random survivors, then
 * tops up with random picks from the rest of the pool.
 */
export function planRotation(
  pool: string[],
  cached: string[],
  target: number,
  swap: number,
  rand: () => number = Math.random,
): { add: string[]; remove: string[] } {
  const inPool = new Set(pool);
  const remove = cached.filter((id) => !inPool.has(id));
  let keep = cached.filter((id) => inPool.has(id));
  shuffle(keep, rand);
  const over = Math.max(0, keep.length - target);
  const drop = Math.max(over, keep.length >= target ? Math.min(swap, keep.length) : 0);
  remove.push(...keep.slice(0, drop));
  keep = keep.slice(drop);
  const have = new Set([...keep, ...remove]); // don't re-add what we just dropped
  const candidates = shuffle(pool.filter((id) => !have.has(id)), rand);
  const add = candidates.slice(0, Math.max(0, target - keep.length));
  return { add, remove };
}

function shuffle<T>(a: T[], rand: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- I/O --------------------------------------------------------------------

const ID = /^[A-Za-z0-9-]{8,64}$/;

async function post(url: string, body: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

interface Album {
  token: string;
  host: string;
}

export class PhotoLibrary {
  private albums: Album[];
  private cached = new Map<string, CachedPhoto>();
  private index: string;
  private running = false;
  private dir: string;
  private target: number;
  private swap: number;

  constructor(urls: string[], dir: string, target = 50, swap = 10) {
    this.dir = dir;
    this.target = target;
    this.swap = swap;
    this.albums = urls.map(albumToken).filter((t): t is string => !!t).map((token) => ({ token, host: 'p01-sharedstreams.icloud.com' }));
    this.index = join(dir, 'index.json');
  }

  get enabled(): boolean {
    return this.albums.length > 0;
  }

  list(): CachedPhoto[] {
    return [...this.cached.values()];
  }

  file(id: string): string | null {
    return ID.test(id) && this.cached.has(id) ? join(this.dir, `${id}.jpg`) : null;
  }

  async start(everyMs: number): Promise<void> {
    if (!this.enabled) return;
    await mkdir(this.dir, { recursive: true });
    try {
      const saved = JSON.parse(await readFile(this.index, 'utf8'));
      if (saved?.v === CACHE_VERSION) for (const p of saved.photos as CachedPhoto[]) this.cached.set(p.id, p);
      else console.log('[photos] cache format changed; refetching');
    } catch {}
    // Anything on disk the index doesn't know (an older format, a crash mid-download) goes.
    for (const f of await readdir(this.dir)) {
      if (f === 'index.json') continue;
      if (!this.cached.has(f.replace(/\.(jpg|tmp)$/, '')) || f.endsWith('.tmp')) await unlink(join(this.dir, f)).catch(() => {});
    }
    const run = () => this.cycle().catch((e) => console.error('[photos] cycle failed', e));
    run();
    setInterval(run, everyMs).unref();
  }

  private async stream(a: Album): Promise<any> {
    for (let hop = 0; hop < 3; hop++) {
      const r = await post(`https://${a.host}/${a.token}/sharedstreams/webstream`, { streamCtag: null });
      if (r.status === 330 && r.json?.['X-Apple-MMe-Host']) { a.host = r.json['X-Apple-MMe-Host']; continue; }
      if (r.status !== 200) throw new Error(`webstream ${r.status}`);
      return r.json;
    }
    throw new Error('webstream: too many redirects');
  }

  async cycle(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const pool = new Map<string, PhotoEntry>();
      for (const [i, a] of this.albums.entries()) {
        try {
          for (const e of entriesFrom(await this.stream(a), i)) pool.set(e.id, e);
        } catch (e) {
          // One album failing must not empty the board: skip this cycle's rotation entirely.
          console.error(`[photos] album ${i} unreachable`, e);
          return;
        }
      }
      const plan = planRotation([...pool.keys()], [...this.cached.keys()], this.target, this.swap);

      let added = 0;
      for (const [i, a] of this.albums.entries()) {
        const want = plan.add.map((id) => pool.get(id)!).filter((e) => e.album === i);
        for (let k = 0; k < want.length; k += 20) {
          const chunk = want.slice(k, k + 20);
          const r = await post(`https://${a.host}/${a.token}/sharedstreams/webasseturls`, { photoGuids: chunk.map((e) => e.id) });
          const items = r.json?.items ?? {};
          for (const e of chunk) {
            const loc = items[e.checksum];
            if (!loc) continue;
            try {
              const { w, h } = await this.download(`https://${loc.url_location}${loc.url_path}`, e.id);
              this.cached.set(e.id, { id: e.id, caption: e.caption, w, h });
              added++;
            } catch (err) {
              console.error(`[photos] download ${e.id} failed`, err);
            }
          }
        }
      }
      // Drop only after the new ones landed, so a failed cycle never shrinks the set.
      for (const id of added > 0 || plan.add.length === 0 ? plan.remove : plan.remove.filter((id) => !pool.has(id))) {
        this.cached.delete(id);
        await unlink(join(this.dir, `${id}.jpg`)).catch(() => {});
      }
      await writeFile(this.index, JSON.stringify({ v: CACHE_VERSION, photos: this.list() }));
      console.log(`[photos] pool ${pool.size} · +${added} −${plan.remove.length} · showing ${this.cached.size}`);
    } finally {
      this.running = false;
    }
  }

  private async download(url: string, id: string): Promise<{ w: number; h: number }> {
    const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const { data, info } = await presize(Buffer.from(await r.arrayBuffer()));
    const tmp = join(this.dir, `${id}.tmp`);
    await writeFile(tmp, data);
    await rename(tmp, join(this.dir, `${id}.jpg`));
    return { w: info.width, h: info.height };
  }
}

/**
 * Upright first (`rotate()` applies EXIF orientation, so a phone photo's stored
 * sideways pixels don't decide its layout), then landscape to 1920 wide and
 * everything else to 1080 tall. Never enlarges.
 */
export async function presize(input: Buffer): Promise<{ data: Buffer; info: { width: number; height: number } }> {
  const upright = await sharp(input).rotate().toBuffer({ resolveWithObject: true });
  const { width, height } = upright.info;
  const box = width / height >= 1.2 ? { width: 1920 } : { height: 1080 };
  return sharp(upright.data).resize({ ...box, withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer({ resolveWithObject: true });
}
