// Seed the board with the dummy chore list through the real hermes push API,
// so chores exercise the same path Eva will use.
//
//   WALLBOARD_URL=https://eva-board.exe.xyz HERMES_TOKEN=... npm run seed
//   ... npm run seed -- --clear-panels   also drop every pushed panel, so the
//                                         board falls back to dummy content
import { SEED_CHORES } from '../web/dummy.js';

const base = process.env.WALLBOARD_URL ?? 'http://localhost:8080';
const headers = { 'content-type': 'application/json', authorization: `Bearer ${process.env.HERMES_TOKEN ?? ''}` };

async function call(method: string, path: string, body?: unknown): Promise<unknown> {
  const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(j)}`);
  return j;
}

console.log('chores:', await call('PUT', '/api/eva/chores', { chores: SEED_CHORES }));
if (process.argv.includes('--clear-panels')) {
  const state = (await call('GET', '/api/eva/state')) as { panels: Record<string, unknown> };
  for (const name of Object.keys(state.panels)) console.log(`panel ${name}:`, await call('DELETE', `/api/eva/panels/${name}`));
}
