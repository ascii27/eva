// One bundle request. Thin, and it never throws.
//
// There is no HTTP here because there does not need to be any: hermes-agent's
// API server is OpenAI-compatible, so this is `src/agent/openai.ts` pointed
// somewhere else. Non-streaming on purpose — nobody is listening to a bundle
// refresh, and the whole object is needed at once before any of it is useful.

import { chat } from '../agent/openai';
import { BUNDLE_SESSION_ID, hermesHeaders, type HermesConfig } from './config';
import { BUNDLE_REQUEST } from './prompt';

/**
 * Generous, and nothing waits on it. hermes runs real tools server-side to
 * build this — calendar, tasks, memory — and a bundle that takes a minute is
 * slow rather than broken. Contrast the local agent's 30s ask timeout, which
 * bounds a round somebody is standing there listening to.
 */
export const BUNDLE_TIMEOUT_MS = 120_000;

/**
 * Keeps a runaway reply from costing hermes tokens forever. Well above what a
 * bundle needs — a realistic one renders to a few hundred tokens — and it is a
 * ceiling on a mistake, not a target.
 */
const MAX_BUNDLE_TOKENS = 4_000;

export type BundleFetch =
  | { ok: true; raw: string; ms: number }
  | { ok: false; error: string; ms: number };

/**
 * Ask hermes for a bundle. Resolves either way; the caller's response to a
 * failure is to keep the bundle it already has, so there is nothing here worth
 * throwing about.
 *
 * `signal` is the caller's (unmount, or a newer refresh superseding this one).
 * The timeout is this function's own, and both abort the same request.
 */
export async function fetchBundle(cfg: HermesConfig, signal?: AbortSignal): Promise<BundleFetch> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BUNDLE_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);

  try {
    const res = await chat({
      apiKey: cfg.apiKey,
      model: cfg.model,
      messages: [{ role: 'user', content: BUNDLE_REQUEST }],
      baseUrl: cfg.baseUrl,
      headers: hermesHeaders(BUNDLE_SESSION_ID),
      maxTokens: MAX_BUNDLE_TOKENS,
      signal: controller.signal,
    });
    return { ok: true, raw: res.text, ms: Date.now() - startedAt };
  } catch (e) {
    const ms = Date.now() - startedAt;
    if (controller.signal.aborted && !signal?.aborted) {
      return { ok: false, error: `no answer in ${BUNDLE_TIMEOUT_MS / 1000}s`, ms };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e), ms };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
