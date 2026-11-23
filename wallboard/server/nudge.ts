// Waking hermes when the family asks for something (ASC-35), instead of hermes
// polling the board. A hermes run is a full agent run — measured at ~325k prompt
// tokens (docs/superpowers/specs/2026-08-21-hermes-bridge-design.md) — so a
// scheduled sync every few minutes spends that all day whether or not anyone
// tapped anything. The board knows exactly when there is work, so it says so.
//
// Policy (pure, tested) + a thin sender, the split weather.ts uses:
// - A pending plan is "asked" once per tap: its key is id@requestedAt, so a new
//   tap (a change of mind) is new work and an old one is not.
// - Wait DEBOUNCE_MS after the newest tap before sending, so a change of mind or
//   a few taps in a row become one run, not several.
// - One message covers every pending plan; hermes' sync handles them all.
// - A plan still pending RETRY_MS after it was last sent is sent again, at most
//   MAX_SENDS times in all. That is the only backstop: no schedule.
// - Never while a send is in flight.
//
// Opt-in: without HERMES_AGENT_URL and HERMES_AGENT_KEY this does nothing, and
// hermes' eva-events skill can still be scheduled the old way.

import type { Plan } from './plans.ts';

export const DEBOUNCE_MS = 60_000;
export const RETRY_MS = 30 * 60_000;
export const MAX_SENDS = 3;

export interface NudgeMemory {
  /** key (id@requestedAt) → { sends, lastAt } */
  sent: Record<string, { sends: number; lastAt: number }>;
  inFlight: boolean;
}

export const emptyMemory = (): NudgeMemory => ({ sent: {}, inFlight: false });

export const planKey = (p: Pick<Plan, 'id' | 'requestedAt'>) => `${p.id}@${p.requestedAt}`;

/**
 * Which pending plans to send hermes now, or [] for "not yet". Sends all
 * pending plans together once any one of them is due.
 */
export function due(plans: Plan[], now: number, mem: NudgeMemory): Plan[] {
  if (mem.inFlight) return [];
  const pending = plans.filter((p) => p.status === 'pending');
  if (!pending.length) return [];
  const newest = Math.max(...pending.map((p) => p.requestedAt));
  if (now - newest < DEBOUNCE_MS) return [];
  const isDue = (p: Plan) => {
    const s = mem.sent[planKey(p)];
    if (!s) return true;
    return s.sends < MAX_SENDS && now - s.lastAt >= RETRY_MS;
  };
  return pending.some(isDue) ? pending.filter((p) => (mem.sent[planKey(p)]?.sends ?? 0) < MAX_SENDS) : [];
}

/** Record a send; forget keys that are no longer pending. */
export function remember(mem: NudgeMemory, sent: Plan[], pending: Plan[], at: number): NudgeMemory {
  const live = new Set(pending.map(planKey));
  const next: NudgeMemory['sent'] = {};
  for (const [k, v] of Object.entries(mem.sent)) if (live.has(k)) next[k] = v;
  for (const p of sent) {
    const k = planKey(p);
    next[k] = { sends: (next[k]?.sends ?? 0) + 1, lastAt: at };
  }
  return { ...mem, sent: next };
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayWords = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;
};

/** The message hermes gets: what was asked, and which skill to run. */
export function message(plans: Plan[]): string {
  const asks = plans.map((p) => (p.want === 'add' ? `add “${p.title}” on ${dayWords(p.day)}` : `take “${p.title}” off (${dayWords(p.day)})`));
  return [
    `From the kitchen board: the family asked you to ${asks.join('; ')}.`,
    'Run the board events sync now, using the eva-events skill, and report each result back to the board with its script.',
    'Reply with one short line saying what you did.',
  ].join(' ');
}

export interface HermesAgent { url: string; key: string; model: string }

/** From the environment, or null when not configured (then nothing is ever sent). */
export function agentFromEnv(env: NodeJS.ProcessEnv): HermesAgent | null {
  const url = env.HERMES_AGENT_URL?.trim().replace(/\/+$/, '');
  const key = env.HERMES_AGENT_KEY?.trim();
  if (!url || !key) return null;
  return { url, key, model: env.HERMES_AGENT_MODEL?.trim() || 'hermes-agent' };
}

const why = (e: unknown) => (e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e));

/**
 * Check every `everyMs` (and whenever `poke()` is called) and send hermes the
 * pending plans when due. The request waits for hermes' reply — a run takes a
 * minute or two — but nothing waits on the request. Never logs the key or the reply.
 */
export function startNudger(agent: HermesAgent, getPlans: () => Plan[], everyMs = 15_000): { poke: () => void } {
  let mem = emptyMemory();
  const check = () => {
    const now = Date.now();
    const plans = getPlans();
    const send = due(plans, now, mem);
    // Forget answered plans even when nothing is sent.
    mem = remember(mem, [], plans.filter((p) => p.status === 'pending'), now);
    if (!send.length) return;
    mem = { ...remember(mem, send, plans.filter((p) => p.status === 'pending'), now), inFlight: true };
    const startedAt = now;
    void (async () => {
      try {
        const r = await fetch(`${agent.url}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${agent.key}`,
            // Its own memory scope and a fresh transcript per run, as the desk's errands do.
            'X-Hermes-Session-Key': 'eva-board',
            'X-Hermes-Session-Id': `eva-board-events-${startedAt}`,
          },
          body: JSON.stringify({ model: agent.model, messages: [{ role: 'user', content: message(send) }], max_completion_tokens: 300 }),
          signal: AbortSignal.timeout(10 * 60_000),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        await r.arrayBuffer();
        console.log(`[nudge] hermes ran the events sync for ${send.length} plan(s) in ${Math.round((Date.now() - startedAt) / 1000)}s`);
      } catch (e) {
        console.error(`[nudge] asking hermes failed after ${Math.round((Date.now() - startedAt) / 1000)}s: ${why(e)}`);
      } finally {
        mem = { ...mem, inFlight: false };
      }
    })();
  };
  setInterval(check, everyMs).unref();
  return { poke: () => setTimeout(check, DEBOUNCE_MS + 1_000).unref() };
}
