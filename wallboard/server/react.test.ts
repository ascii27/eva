import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bubbleHidden, ChoreReactor, MAX_WAIT_MS, noteEvent, reactionMessage, sendToHermes, SETTLE_MS, type Tick, type TodayChore } from './react.ts';
import type { LogEvent } from './state.ts';

/** Tokyo wall-clock time on 2026-11-25 as epoch ms. */
const tokyo = (hh: number, mm = 0) => Date.UTC(2026, 10, 25, hh - 9, mm);

let seq = 0;
const done = (id: string, who: string, title: string, at: number): LogEvent =>
  ({ type: 'done', id, seq: ++seq, at, who, delta: 100, choreId: `chore-${title}`, title, amount: 100 });
const undone = (cancels: string, who: string, at: number): LogEvent =>
  ({ type: 'undone', id: `u-${cancels}`, seq: ++seq, at, who, delta: -100, cancels, choreId: null, title: null });
const payment = (at: number): LogEvent =>
  ({ type: 'payment', id: `p-${at}`, seq: ++seq, at, who: 'sarina', delta: -500, amount: 500, source: 'board', note: null });

test('a tick is added; an undo takes its own tick back out; a payment is ignored', () => {
  let p: Tick[] = [];
  p = noteEvent(p, done('e1', 'sarina', 'Make bed', 1));
  p = noteEvent(p, done('e2', 'mariko', 'Dishes', 2));
  assert.deepEqual(p.map((t) => t.eventId), ['e1', 'e2']);
  p = noteEvent(p, undone('e1', 'sarina', 3));
  assert.deepEqual(p.map((t) => t.eventId), ['e2']);
  p = noteEvent(p, undone('older', 'sarina', 4));
  p = noteEvent(p, payment(5));
  assert.deepEqual(p.map((t) => t.eventId), ['e2']);
});

test('the bubble is hidden from 21:30 to 06:30 Tokyo time', () => {
  assert.equal(bubbleHidden(tokyo(21, 29)), false);
  assert.equal(bubbleHidden(tokyo(21, 30)), true);
  assert.equal(bubbleHidden(tokyo(23, 59)), true);
  assert.equal(bubbleHidden(tokyo(3)), true);
  assert.equal(bubbleHidden(tokyo(6, 29)), true);
  assert.equal(bubbleHidden(tokyo(6, 30)), false);
  assert.equal(bubbleHidden(tokyo(17, 45)), false);
});

test('the message says who ticked what and where each girl stands, never money', () => {
  const ticks = [
    { eventId: 'e1', choreId: 'c1', title: 'Make bed', who: 'sarina', at: tokyo(17, 40) },
    { eventId: 'e2', choreId: 'c2', title: 'Feed the fish', who: 'sarina', at: tokyo(17, 42) },
  ];
  const today: TodayChore[] = [
    { title: 'Make bed', who: 'sarina', done: true },
    { title: 'Feed the fish', who: 'sarina', done: true },
    { title: 'Dishes', who: 'mariko', done: false },
    { title: 'Laundry', who: 'mariko', done: true },
  ];
  const m = reactionMessage(ticks, today, tokyo(17, 44));
  assert.match(m, /Sarina ticked "Make bed" and "Feed the fish" \(at 17:42\)/);
  assert.match(m, /Sarina: all 2 done\./);
  assert.match(m, /Mariko: 1 of 2 done; still to do "Dishes"\./);
  assert.doesNotMatch(m, /Every chore on the board is done/);
  assert.match(m, /eva-board-bubble skill/);
  assert.match(m, /It is 17:44 in Tokyo/);
  assert.doesNotMatch(m, /¥|yen|100/);
});

test('the message says so when every chore is done', () => {
  const ticks = [{ eventId: 'e1', choreId: 'c1', title: 'Dishes', who: 'mariko', at: tokyo(19) }];
  const m = reactionMessage(ticks, [{ title: 'Dishes', who: 'mariko', done: true }, { title: 'Bed', who: 'sarina', done: true }], tokyo(19));
  assert.match(m, /Every chore on the board is done for today\./);
});

/** A reactor on a fake clock. `advance` runs due timers in order. */
function harness(start: number, send: (m: string) => Promise<void> = async () => {}) {
  let now = start;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 0;
  const sent: string[] = [];
  const logs: string[] = [];
  const r = new ChoreReactor({
    now: () => now,
    setTimer: (fn, ms) => { const id = ++nextId; timers.push({ at: now + ms, fn, id }); return id; },
    clearTimer: (id) => { timers = timers.filter((t) => t.id !== id); },
    today: () => [{ title: 'Make bed', who: 'sarina', done: true }],
    send: (m) => { sent.push(m); return send(m); },
    log: (l) => logs.push(l),
  });
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > end) break;
      timers.shift();
      now = t.at;
      t.fn();
      await new Promise((res) => setImmediate(res));
    }
    now = end;
  };
  return { r, sent, logs, advance, at: () => now };
}

test('ticks in a row are told once, after the board settles', async () => {
  const h = harness(tokyo(17));
  h.r.onEvent(done('a', 'sarina', 'Make bed', h.at()));
  await h.advance(60_000);
  h.r.onEvent(done('b', 'sarina', 'Feed the fish', h.at()));
  await h.advance(SETTLE_MS - 1);
  assert.equal(h.sent.length, 0);
  await h.advance(1);
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0], /"Make bed" and "Feed the fish"/);
});

test('a mis-tap undone before the board settles tells nobody', async () => {
  const h = harness(tokyo(17));
  h.r.onEvent(done('a', 'sarina', 'Make bed', h.at()));
  await h.advance(5_000);
  h.r.onEvent(undone('a', 'sarina', h.at()));
  await h.advance(10 * 60_000);
  assert.equal(h.sent.length, 0);
});

test('a steady stream of ticks is still told by MAX_WAIT_MS after the first', async () => {
  const h = harness(tokyo(17));
  for (let i = 0; i < 20; i++) {
    h.r.onEvent(done(`t${i}`, 'mariko', `Chore ${i}`, h.at()));
    await h.advance(60_000);
    if (h.sent.length) break;
  }
  assert.equal(h.sent.length, 1);
  assert.ok(h.at() <= tokyo(17) + MAX_WAIT_MS + 60_000);
});

test('nothing is told at night', async () => {
  const h = harness(tokyo(21, 45));
  h.r.onEvent(done('a', 'sarina', 'Make bed', h.at()));
  await h.advance(SETTLE_MS);
  assert.equal(h.sent.length, 0);
  assert.match(h.logs.join('\n'), /at night/);
});

test('one reaction at a time: ticks during a hermes run go out after it', async () => {
  let finish: () => void = () => {};
  const h = harness(tokyo(17), () => new Promise<void>((res) => { finish = res; }));
  h.r.onEvent(done('a', 'sarina', 'Make bed', h.at()));
  await h.advance(SETTLE_MS);
  assert.equal(h.sent.length, 1);
  h.r.onEvent(done('b', 'mariko', 'Dishes', h.at()));
  await h.advance(SETTLE_MS * 2);
  assert.equal(h.sent.length, 1, 'waits for the run in flight');
  finish();
  await new Promise((res) => setImmediate(res));
  await h.advance(SETTLE_MS);
  assert.equal(h.sent.length, 2);
  assert.match(h.sent[1], /Mariko ticked "Dishes"/);
});

test('a failed send is logged, not retried', async () => {
  const h = harness(tokyo(17), async () => { throw new Error('HTTP 502'); });
  h.r.onEvent(done('a', 'sarina', 'Make bed', h.at()));
  await h.advance(SETTLE_MS * 10);
  assert.equal(h.sent.length, 1);
  assert.match(h.logs.join('\n'), /hermes failed: HTTP 502/);
});

test('sendToHermes posts a chat completion with its own session headers', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response('{}', { status: 200 });
  }) as unknown as typeof fetch;
  await sendToHermes({ url: 'https://hermes.example/', key: 'k', model: 'hermes-agent' }, 'hello', tokyo(8), fake);
  assert.equal(calls[0].url, 'https://hermes.example/v1/chat/completions');
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, 'Bearer k');
  assert.equal(headers['X-Hermes-Session-Key'], 'eva-board');
  assert.equal(headers['X-Hermes-Session-Id'], 'eva-board-chores-2026-11-25');
  assert.deepEqual(JSON.parse(calls[0].init.body as string), { model: 'hermes-agent', stream: false, messages: [{ role: 'user', content: 'hello' }] });

  const failing = (async () => new Response('no', { status: 401 })) as unknown as typeof fetch;
  await assert.rejects(sendToHermes({ url: 'https://hermes.example', key: 'k', model: 'm' }, 'x', tokyo(8), failing), /HTTP 401/);
});
