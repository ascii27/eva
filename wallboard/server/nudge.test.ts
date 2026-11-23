import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentFromEnv, DEBOUNCE_MS, due, emptyMemory, MAX_SENDS, message, remember, RETRY_MS } from './nudge.ts';
import type { Plan } from './plans.ts';

const plan = (id: string, requestedAt: number, extra: Partial<Plan> = {}): Plan => ({
  id, title: `Event ${id}`, url: 'u', day: '2026-11-28', want: 'add', status: 'pending', requestedAt, updatedAt: requestedAt, ...extra,
});
const T = 1_000_000_000;

test('nothing pending, nothing to send', () => {
  assert.deepEqual(due([plan('a', T, { status: 'done' })], T + DEBOUNCE_MS * 10, emptyMemory()), []);
});

test('waits for the taps to settle, then sends everything pending at once', () => {
  const plans = [plan('a', T), plan('b', T + 30_000)];
  assert.deepEqual(due(plans, T + DEBOUNCE_MS, emptyMemory()), []); // b was tapped 30 s ago
  assert.deepEqual(due(plans, T + 30_000 + DEBOUNCE_MS, emptyMemory()).map((p) => p.id), ['a', 'b']);
});

test('sent once, not again until the retry interval; at most MAX_SENDS in all', () => {
  const plans = [plan('a', T)];
  let at = T + DEBOUNCE_MS;
  let mem = remember(emptyMemory(), due(plans, at, emptyMemory()), plans, at);
  assert.deepEqual(due(plans, at + RETRY_MS - 1, mem), []);
  for (let n = 1; n < MAX_SENDS; n++) {
    at += RETRY_MS;
    const send = due(plans, at, mem);
    assert.equal(send.length, 1, `retry ${n}`);
    mem = remember(mem, send, plans, at);
  }
  assert.deepEqual(due(plans, at + RETRY_MS * 5, mem), []); // given up
});

test('a new tap on the same event is new work; answered plans are forgotten', () => {
  const at = T + DEBOUNCE_MS;
  const mem = remember(emptyMemory(), [plan('a', T)], [plan('a', T)], at);
  const changed = [plan('a', T + 120_000, { want: 'remove' })];
  assert.deepEqual(due(changed, T + 120_000 + DEBOUNCE_MS, mem).map((p) => p.want), ['remove']);
  assert.deepEqual(remember(mem, [], [], at).sent, {});
});

test('one due plan brings the others along, but not ones already given up on', () => {
  let mem = emptyMemory();
  for (let i = 0; i < MAX_SENDS; i++) mem = remember(mem, [plan('old', T)], [plan('old', T)], T + i * RETRY_MS);
  const plans = [plan('old', T), plan('new', T + 10 * RETRY_MS)];
  assert.deepEqual(due(plans, T + 10 * RETRY_MS + DEBOUNCE_MS, mem).map((p) => p.id), ['new']);
});

test('never while a send is in flight', () => {
  assert.deepEqual(due([plan('a', T)], T + DEBOUNCE_MS, { ...emptyMemory(), inFlight: true }), []);
});

test('the message names each request and the skill', () => {
  const m = message([plan('a', T), plan('b', T, { want: 'remove', title: 'D.League', day: '2026-12-10' })]);
  assert.match(m, /add “Event a” on Sat 28 Nov; take “D\.League” off \(Thu 10 Dec\)/);
  assert.match(m, /eva-events skill/);
});

test('configured only with both a URL and a key', () => {
  assert.equal(agentFromEnv({ HERMES_AGENT_URL: 'https://h/v1' }), null);
  assert.deepEqual(agentFromEnv({ HERMES_AGENT_URL: 'https://h/v1/', HERMES_AGENT_KEY: 'k' }), { url: 'https://h/v1', key: 'k', model: 'hermes-agent' });
});
