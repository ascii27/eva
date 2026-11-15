// Two credentials, because the two writers are different kinds of client.
//
// BOARD_TOKEN — the Echo Show. A kitchen screen can't do a login flow, so it is
// enrolled once by opening /?key=<token>, which sets a long-lived cookie and
// redirects to a clean URL (so the token isn't left in the address bar).
//
// HERMES_TOKEN — Eva's back half pushing panels and chore lists. A bearer token,
// and the only thing allowed to write anything other than marking a chore done.
//
// An unset token means that check is off. That is for local dev only; the
// deploy script generates both.

import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

export const COOKIE = 'wallboard';

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function readCookie(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function isBoard(req: IncomingMessage, boardToken: string | undefined): boolean {
  if (!boardToken) return true;
  const c = readCookie(req, COOKIE);
  return c !== null && same(c, boardToken);
}

export function isHermes(req: IncomingMessage, hermesToken: string | undefined): boolean {
  if (!hermesToken) return true;
  const h = req.headers.authorization ?? '';
  return h.startsWith('Bearer ') && same(h.slice(7), hermesToken);
}

export function enrollCookie(token: string): string {
  const tenYears = 10 * 365 * 24 * 3600;
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${tenYears}; HttpOnly; Secure; SameSite=Lax`;
}

export function keyMatches(given: string | null, boardToken: string | undefined): boolean {
  return !!boardToken && given !== null && same(given, boardToken);
}
