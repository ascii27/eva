// Is Eva's other half reachable, and what does a bundle actually cost?
// `npm run probe:hermes`
//
// Everything about the bridge that this repo cannot know without asking:
// whether the API server is up and the key works, whether it accepts the
// options the device sends, how long a real bundle run takes, how many tokens
// it burns, whether what comes back parses, and what it looks like once
// rendered into the prompt.
//
// Same reason probe-tools.ts and probe-vision.ts exist: jest cannot reach the
// network, and "the model won't do X" / "the server won't take Y" are claims
// about a specific deployment that should be measured in a second rather than
// discovered on the device.
//
// Costs one hermes agent run — which is not free, and finding out how not-free
// is half the point.

import { readFileSync } from 'node:fs';
import { BUNDLE_REQUEST } from '../src/hermes/prompt.ts';
import { BUNDLE_SESSION_ID, envHermesConfig, hermesHeaders } from '../src/hermes/config.ts';
import { budgetCore, coreTokens, parseBundle, renderCore, renderVolatile } from '../src/hermes/bundle.ts';

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

// Let the real config module make the decision, so the probe exercises the same
// precedence and normalisation the device does.
for (const name of ['EXPO_PUBLIC_HERMES_BASE_URL', 'EXPO_PUBLIC_HERMES_KEY', 'EXPO_PUBLIC_HERMES_MODEL']) {
  process.env[name] ??= envLocal(name) ?? undefined;
}

const cfg = envHermesConfig();
if (!cfg) {
  console.error('No hermes configured. Set EXPO_PUBLIC_HERMES_BASE_URL and EXPO_PUBLIC_HERMES_KEY');
  console.error('in .env.local — see hermes/config/api-server.example.env for the server side.');
  process.exit(1);
}

const auth = { Authorization: `Bearer ${cfg.apiKey}`, ...hermesHeaders(BUNDLE_SESSION_ID) };
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

async function probeGet(path: string): Promise<unknown | null> {
  try {
    const res = await fetch(`${cfg!.baseUrl}${path}`, { headers: auth });
    if (!res.ok) {
      console.log(`  ${path} → http ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (e) {
    console.log(`  ${path} → ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

console.log(`hermes at ${cfg.baseUrl}, model "${cfg.model}"\n`);

console.log('Discovery');
const models = (await probeGet('/models')) as { data?: { id?: string }[] } | null;
if (models?.data) {
  const ids = models.data.map((m) => m.id).filter(Boolean);
  console.log(`  /models → ${ids.join(', ') || 'none listed'}`);
  if (ids.length && !ids.includes(cfg.model)) {
    console.log(`  ⚠  "${cfg.model}" is not in that list — set EXPO_PUBLIC_HERMES_MODEL to one that is.`);
  }
}
const caps = (await probeGet('/capabilities')) as Record<string, unknown> | null;
if (caps) console.log(`  /capabilities → ${Object.keys(caps).join(', ')}`);
const skills = (await probeGet('/skills')) as { data?: { name?: string }[] } | null;
if (skills?.data) {
  const names = skills.data.map((s) => s.name).filter(Boolean);
  console.log(`  /skills → ${names.length} installed${names.includes('eva-bundle') ? ', including eva-bundle' : ''}`);
  if (!names.includes('eva-bundle')) {
    console.log('  ⚠  eva-bundle is not installed — see hermes/skills/eva-bundle/SKILL.md.');
  }
}

/** One bundle request. `maxTokens` is the option whose acceptance is in doubt. */
async function requestBundle(maxTokens: number | null): Promise<{ text: string; usage: unknown; ms: number } | string> {
  const startedAt = Date.now();
  try {
    const res = await fetch(`${cfg!.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        model: cfg!.model,
        messages: [{ role: 'user', content: BUNDLE_REQUEST }],
        ...(maxTokens === null ? {} : { max_completion_tokens: maxTokens }),
      }),
    });
    const body = await res.text();
    if (!res.ok) return `http ${res.status}: ${body.slice(0, 300)}`;
    const data = JSON.parse(body) as { choices?: { message?: { content?: string } }[]; usage?: unknown };
    return { text: data.choices?.[0]?.message?.content ?? '', usage: data.usage, ms: Date.now() - startedAt };
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

console.log('\nBundle request');
// The device sends max_completion_tokens. Every OpenAI family accepts it, but
// hermes is compatible rather than OpenAI, so it is worth one explicit answer.
let result = await requestBundle(4_000);
if (typeof result === 'string') {
  console.log(`  with max_completion_tokens → ${result}`);
  console.log('  retrying without it…');
  result = await requestBundle(null);
  if (typeof result !== 'string') console.log('  ⚠  hermes rejects max_completion_tokens — drop it from client.ts.');
} else {
  console.log('  max_completion_tokens accepted');
}

if (typeof result === 'string') {
  console.log(`  → ${result}`);
  process.exit(1);
}

console.log(`  round trip ${secs(result.ms)}`);
if (result.usage) console.log(`  usage ${JSON.stringify(result.usage)}`);
console.log(`  ${result.text.length} chars back\n`);

console.log('Raw response');
console.log(result.text.length > 2_000 ? `${result.text.slice(0, 2_000)}\n  …truncated` : result.text);

console.log('\nParsed');
const bundle = parseBundle(result.text);
if (!bundle) {
  console.log('  ✗ did not parse — the device would keep its previous bundle and log this.');
  console.log('    Check that hermes replied with the object and nothing else, and that');
  console.log('    generatedAt is an ISO stamp. See src/hermes/prompt.ts for the shape.');
  process.exit(1);
}

const filled = (Object.entries(bundle) as [string, unknown][])
  .filter(([k]) => k !== 'generatedAt')
  .map(([k, v]) => {
    if (Array.isArray(v)) return `${k}=${v.length}`;
    if (v && typeof v === 'object') {
      const parts = Object.entries(v as Record<string, unknown>)
        .map(([sk, sv]) => `${sk}=${Array.isArray(sv) ? sv.length : sv === null ? '—' : 'set'}`)
        .join(' ');
      return `${k}(${parts})`;
    }
    return `${k}=${v === null ? '—' : String(v)}`;
  });
console.log(`  stamped ${new Date(bundle.generatedAt).toISOString()}`);
console.log(`  ${filled.join('  ')}`);
console.log(`  (— means the section was absent, which reads differently to Eva than 0)`);

const cut = budgetCore(bundle);
const before = coreTokens(bundle);
console.log(`\n  core ≈ ${before} tokens${before === coreTokens(cut) ? '' : ` → ${coreTokens(cut)} after truncation`}`);

console.log('\nRendered core');
console.log(renderCore(cut));
console.log('\nRendered volatile, now');
console.log(renderVolatile(cut, Date.now()));
console.log('\nRendered volatile, if this were 35 minutes old');
console.log(renderVolatile(cut, bundle.generatedAt + 35 * 60_000));
