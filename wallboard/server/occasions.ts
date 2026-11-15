// The countdown tile's default when Eva hasn't pushed `countdowns`: the nearest
// upcoming birthday (from the calendar) or major Japanese/US holiday. Pure:
// Tokyo dates in, one countdown out. Published as the `occasion` panel; the
// board prefers a pushed `countdowns` panel over it.
//
// Decided 2026-11-15. The holiday list is deliberately short — days the family
// actually looks forward to, not every national holiday.

export interface Occasion { label: string; days: number; icon: string; date: string }
export interface Birthday { date: string; title: string }

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** The nth (1-based) weekday `wd` (0 = Sunday) of month `m` in year `y`. */
function nthWeekday(y: number, m: number, wd: number, n: number): string {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return ymd(y, m, 1 + ((wd - first + 7) % 7) + (n - 1) * 7);
}

/** Western Easter Sunday (anonymous Gregorian algorithm). */
function easter(y: number): string {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  return ymd(y, month, ((h + l - 7 * m + 114) % 31) + 1);
}

export function holidays(y: number): { date: string; label: string }[] {
  return [
    { date: ymd(y, 1, 1), label: 'New Year' },
    { date: ymd(y, 3, 3), label: 'Hinamatsuri' },
    { date: easter(y), label: 'Easter' },
    { date: ymd(y, 5, 5), label: "Children's Day" },
    { date: nthWeekday(y, 5, 0, 2), label: "Mother's Day" },   // same day in JP and US
    { date: nthWeekday(y, 6, 0, 3), label: "Father's Day" },   // same day in JP and US
    { date: ymd(y, 7, 4), label: 'July 4th' },
    { date: ymd(y, 10, 31), label: 'Halloween' },
    { date: nthWeekday(y, 11, 4, 4), label: 'Thanksgiving' },
    { date: ymd(y, 12, 25), label: 'Christmas' },
  ];
}

const dayNum = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

/**
 * The nearest occasion strictly after `today` (on the day itself the tile has
 * already moved on: "0 days" reads as a mistake). A birthday wins a tie.
 */
export function nextOccasion(today: string, birthdays: Birthday[]): Occasion {
  const y = Number(today.slice(0, 4));
  const cands = [
    ...birthdays.map((b) => ({ date: b.date, label: b.title, rank: 0 })),
    ...[...holidays(y), ...holidays(y + 1)].map((h) => ({ ...h, rank: 1 })),
  ].filter((c) => c.date > today);
  cands.sort((a, b) => a.date.localeCompare(b.date) || a.rank - b.rank);
  const c = cands[0];   // never empty: next year's holidays are always ahead
  return { label: c.label, days: dayNum(c.date) - dayNum(today), icon: 'gift', date: c.date };
}

/** A calendar event counts as a birthday by its title. */
export const isBirthday = (title: string) => /birthday|b-?day|誕生日/i.test(title);
