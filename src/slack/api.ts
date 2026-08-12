// Slack Web API calls the device makes directly — no SDK, just fetch.

const BASE = 'https://slack.com/api';

async function call<T extends { ok: boolean; error?: string }>(
  method: string,
  token: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${BASE}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method}: http ${res.status}`);
  const data = (await res.json()) as T;
  if (!data.ok) throw new Error(`${method}: ${data.error ?? 'unknown_error'}`);
  return data;
}

/**
 * Open a Socket Mode connection URL. The returned wss URL is single-use and
 * expires in ~30 s — fetch a fresh one for every connect attempt.
 */
export async function connectionsOpen(appToken: string): Promise<string> {
  const data = await call<{ ok: boolean; error?: string; url: string }>('apps.connections.open', appToken);
  return data.url;
}

/** `threadTs` (a thread root) keeps the exchange inside a thread Eva started. */
export async function postMessage(
  botToken: string,
  channel: string,
  text: string,
  threadTs?: string,
): Promise<{ ts: string }> {
  const data = await call<{ ok: boolean; error?: string; ts: string }>('chat.postMessage', botToken, {
    channel,
    text,
    ...(threadTs ? { thread_ts: threadTs } : {}),
  });
  return { ts: data.ts };
}

/** Validate a bot token at pairing time; returns our bot's user id. */
export async function authTest(botToken: string): Promise<{ botUserId: string; team: string }> {
  const data = await call<{ ok: boolean; error?: string; user_id: string; team: string }>('auth.test', botToken);
  return { botUserId: data.user_id, team: data.team };
}
