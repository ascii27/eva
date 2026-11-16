// Pure date math for repeating chores. Days are YYYY-MM-DD strings; "today" is Tokyo (UTC+9, no DST).
// Arithmetic runs on UTC-midnight day numbers so nothing depends on the host timezone.

export interface Schedule {
  every: number;
  unit: 'day' | 'week';
  start: string;
}

const DAY_MS = 86_400_000;
const TOKYO_OFFSET_MS = 9 * 3_600_000;

const toNum = (day: string): number => Math.floor(Date.parse(day + 'T00:00:00Z') / DAY_MS);
const fromNum = (n: number): string => new Date(n * DAY_MS).toISOString().slice(0, 10);
const stepDays = (s: Schedule): number => s.every * (s.unit === 'week' ? 7 : 1);

export function tokyoDay(at: number): string {
  return new Date(at + TOKYO_OFFSET_MS).toISOString().slice(0, 10);
}

/** First occurrence >= day (occurrences are start + k*step, k >= 0). */
export function firstOnOrAfter(s: Schedule, day: string): string {
  const start = toNum(s.start);
  const target = toNum(day);
  if (start >= target) return s.start;
  const step = stepDays(s);
  return fromNum(start + Math.ceil((target - start) / step) * step);
}

/** First occurrence strictly after day. */
export function nextAfter(s: Schedule, day: string): string {
  return firstOnOrAfter(s, fromNum(toNum(day) + 1));
}

export function parseSchedule(raw: unknown): Schedule | string {
  if (typeof raw !== 'object' || raw === null) return 'schedule must be an object';
  const { every, unit, start } = raw as Record<string, unknown>;
  if (typeof every !== 'number' || !Number.isInteger(every) || every < 1) return 'every must be an integer >= 1';
  if (unit !== 'day' && unit !== 'week') return "unit must be 'day' or 'week'";
  if (typeof start !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return 'start must be YYYY-MM-DD';
  const t = Date.parse(start + 'T00:00:00Z');
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== start) return 'start is not a real date';
  return { every, unit, start };
}
