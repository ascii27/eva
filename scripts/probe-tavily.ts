// Check Eva's web search against the real Tavily API: `npm run probe:tavily`.
//
// This is a script rather than a jest test on purpose. jest-expo's setupFiles
// replace global.fetch with React Native's XHR-backed polyfill, and jest
// provides no XMLHttpRequest — so under jest every request resolves to a stub
// with no status and nothing can reach the network, in any testEnvironment.
//
// It exists because search.test.ts checks formatResults against a fixture we
// wrote ourselves. Green tests against an invented fixture prove nothing about
// the live API, and a response shape that drifts would leave them green and
// useless. This is the thing that would notice.
//
// Run with node's native TypeScript stripping (node 22.6+); no build step.
// Costs one Tavily credit per query, out of 1,000 free per month.

import { readFileSync } from 'node:fs';
import { formatResults, runSearch, type TavilyResponse } from '../src/agent/tools/search.ts';

/** Read one var out of .env.local, so the key never has to be pasted onto a command line. */
function envLocal(name: string): string | null {
  try {
    const line = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
      .split('\n')
      .find((l) => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') : null;
  } catch {
    return null;
  }
}

// Stable answers, so a failure means the integration broke rather than that the
// news moved. The second is deliberately wordier — that is the one whose digest
// is worth reading aloud to judge.
const QUERIES = ['what is the capital city of Australia', 'what is the tallest building in the world right now'];

const key = process.env.EXPO_PUBLIC_TAVILY_API_KEY ?? envLocal('EXPO_PUBLIC_TAVILY_API_KEY');
if (!key) {
  console.error('No EXPO_PUBLIC_TAVILY_API_KEY in the environment or .env.local. Get one at tavily.com.');
  process.exit(1);
}

let failures = 0;
const check = (label: string, ok: boolean, detail?: string) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail && !ok ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// 1. The shape formatResults is built on. If either field has moved, the
//    fixture in search.test.ts is fiction and its tests prove nothing.
console.log('\nresponse shape');
const res = await fetch('https://api.tavily.com/search', {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: QUERIES[0], include_answer: true, search_depth: 'basic', max_results: 5 }),
});
check('http 200', res.ok, `http ${res.status}`);
const data = (await res.json()) as TavilyResponse;
check('answer is a string', typeof data.answer === 'string', typeof data.answer);
check('results is an array', Array.isArray(data.results), typeof data.results);
check('results carry title and content', typeof data.results?.[0]?.title === 'string' && typeof data.results?.[0]?.content === 'string');

// 2. A bad key must come back as a sentence Eva can say, never a throw.
console.log('\nfailure path');
const rejected = await runSearch('tvly-definitely-not-a-key', QUERIES[0]);
check('a bad key returns a sentence, not a throw', /failed|could not/i.test(rejected), rejected);

// 3. What Eva would actually work from. Read these aloud — that is the test.
for (const query of QUERIES) {
  console.log(`\n--- "${query}" ---`);
  const started = Date.now();
  const digest = await runSearch(key, query);
  console.log(digest);
  console.log(`\n[${((Date.now() - started) / 1000).toFixed(1)}s, ${digest.length} chars]`);
  check('no URLs survive into the digest', !digest.includes('http'));
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
