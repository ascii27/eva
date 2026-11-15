import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { albumToken, entriesFrom, planRotation, presize } from './photos.ts';

test('albumToken takes what follows # and drops any ;suffix', () => {
  assert.equal(albumToken('https://www.icloud.com/sharedalbum/#B0aGWZuqDGKsJ9U'), 'B0aGWZuqDGKsJ9U');
  assert.equal(albumToken('https://www.icloud.com/sharedalbum/#B0aGWZuqDGKsJ9U;ABC'), 'B0aGWZuqDGKsJ9U');
  assert.equal(albumToken('https://www.icloud.com/sharedalbum/'), null);
});

test('entriesFrom keeps stills of any orientation, takes the largest derivative, falls back to the album name', () => {
  const d = (w: number, c: string) => ({ width: String(w), checksum: c });
  const out = entriesFrom(
    {
      streamName: 'Family',
      photos: [
        { photoGuid: 'land', width: '2000', height: '1500', caption: '', derivatives: { a: d(342, 'small'), b: d(2000, 'big') } },
        { photoGuid: 'tall', width: '1500', height: '2000', derivatives: { a: d(1500, 'x') } },
        { photoGuid: 'vid', width: '1280', height: '720', mediaAssetType: 'video', derivatives: { a: d(1280, 'v') } },
        { photoGuid: 'cap', width: '1000', height: '1000', caption: ' Beach day ', derivatives: { a: d(1000, 'c') } },
      ],
    },
    0,
  );
  assert.deepEqual(out, [
    { id: 'land', checksum: 'big', caption: 'Family', album: 0 },
    { id: 'tall', checksum: 'x', caption: 'Family', album: 0 },
    { id: 'cap', checksum: 'c', caption: 'Beach day', album: 0 },
  ]);
});

const pool = Array.from({ length: 200 }, (_, i) => `p${i}`);

test('a first run fills to the target', () => {
  const plan = planRotation(pool, [], 50, 10);
  assert.equal(plan.add.length, 50);
  assert.equal(plan.remove.length, 0);
  assert.equal(new Set(plan.add).size, 50);
});

test('a full set swaps a few, never re-adds what it drops, and stays at the target', () => {
  const cached = pool.slice(0, 50);
  const plan = planRotation(pool, cached, 50, 10);
  assert.equal(plan.remove.length, 10);
  assert.equal(plan.add.length, 10);
  for (const id of plan.add) assert.ok(!cached.includes(id));
});

test('photos removed from the album are dropped and replaced', () => {
  const cached = ['gone', ...pool.slice(0, 49)];
  const plan = planRotation(pool, cached, 50, 0);
  assert.deepEqual(plan.remove, ['gone']);
  assert.equal(plan.add.length, 1);
});

test('a pool smaller than the target just shows the whole pool', () => {
  const plan = planRotation(['a', 'b'], [], 50, 10);
  assert.deepEqual(plan.add.sort(), ['a', 'b']);
});

const jpeg = (width: number, height: number, orientation?: number) => {
  const img = sharp({ create: { width, height, channels: 3, background: '#888' } }).jpeg();
  return (orientation ? img.withMetadata({ orientation }) : img).toBuffer();
};

test('presize: landscape to 1920 wide, portrait to 1080 tall, never enlarged', async () => {
  assert.deepEqual((await presize(await jpeg(4000, 3000))).info.width, 1920);
  const p = (await presize(await jpeg(3000, 4000))).info;
  assert.deepEqual([p.width, p.height], [810, 1080]);
  const small = (await presize(await jpeg(800, 600))).info;
  assert.deepEqual([small.width, small.height], [800, 600]);
});

test('presize applies EXIF orientation before choosing the layout', async () => {
  // Stored 4000×3000 but flagged "rotate 90°": it is really a portrait.
  const info = (await presize(await jpeg(4000, 3000, 6))).info;
  assert.ok(info.height > info.width, `expected portrait, got ${info.width}×${info.height}`);
  assert.equal(info.height, 1080);
});
