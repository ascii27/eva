// Where Eva's other half lives, and how to address it.
//
// Env-only, with no pairing screen and nothing in AsyncStorage — the same
// posture as the Tavily key in src/agent/config.ts, and for the same reason:
// its absence is a supported state. With no hermes configured the device simply
// never fetches a bundle and `buildRequest` gets none, which is exactly how the
// app behaved before this existed. A half-configured hermes that fails on every
// refresh would be strictly worse than no hermes at all.
//
// Note that EXPO_PUBLIC_* vars are inlined into the JS bundle at Metro start, so
// this key is not secret from anyone holding the phone. That is already true of
// the OpenAI and Slack credentials, but it lands harder here: this key reaches
// an agent holding Michael's calendar and memory. See the deployment note in
// hermes/config/api-server.example.env — put it behind TLS, not on a LAN bind.

export interface HermesConfig {
  /** Origin plus version path, no trailing slash — e.g. https://host/v1 */
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * hermes names the model after the profile. Measured from `/v1/models` on the
 * live gateway 2026-08-21 — the server turns out to accept anything in this
 * field, but matching what it advertises costs nothing and stops the probe
 * warning about it.
 */
export const DEFAULT_HERMES_MODEL = 'hermes-agent';

/**
 * Long-term memory scope. Stable forever: what hermes learns from the desk
 * should accumulate in one place across relaunches, reinstalls, and phones.
 */
export const SESSION_KEY = 'eva-device';

/**
 * Transcript scope for bundle refreshes, kept separate from anything Michael
 * says. A refresh is machinery, and several hundred of them a day landing in
 * hermes' actual conversation with him would bury it.
 */
export const BUNDLE_SESSION_ID = 'eva-bundle';

export function hermesHeaders(sessionId: string): Record<string, string> {
  return { 'X-Hermes-Session-Key': SESSION_KEY, 'X-Hermes-Session-Id': sessionId };
}

/** Trailing slashes are the classic way to end up POSTing to `//chat/completions`. */
function normalize(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * hermes from .env.local, or null when it is not configured. Both the URL and
 * the key are required: a base URL with no key would fail on every refresh
 * rather than being cleanly absent.
 */
export function envHermesConfig(): HermesConfig | null {
  const baseUrl = process.env.EXPO_PUBLIC_HERMES_BASE_URL;
  const apiKey = process.env.EXPO_PUBLIC_HERMES_API_KEY;
  if (!baseUrl || !apiKey) return null;
  return {
    baseUrl: normalize(baseUrl),
    apiKey,
    model: process.env.EXPO_PUBLIC_HERMES_MODEL || DEFAULT_HERMES_MODEL,
  };
}
