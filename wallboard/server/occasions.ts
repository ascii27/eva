// What the countdown tile ("Coming up") rotates through: the nearest birthday
// (from the calendar), the nearest major Japanese/US holiday and the nearest
// school event (from the calendar, if there is one). Pure: Tokyo dates in,
// countdowns out. Published as the `occasions` panel; the board rotates these
// together with anything Eva pushed in `countdowns` (ASC-25).
//
// Decided 2026-11-15. The holiday list is deliberately short — days the family
// actually looks forward to, not every national holiday.

/**
 * One countdown. `kind` picks the tile's icon, colour and celebration (CLAUDE.md
 * "Countdown kinds", design/EventIcons): each built-in holiday has its own
 * kind (christmas = tree + snow, halloween = pumpkin + orange/purple confetti, …).
 * `icon` mirrors the board's choice for that kind; the board decides from `kind`.
 */
export interface Occasion {
  label: string;
  days: number;
  icon: string;
  date: string;
  kind: string;
  /** Birthdays of someone in the household: their id, for the tile's colours. */
  who?: string;
  /** The first line when the tile is tapped, e.g. "Sarina's birthday". */
  headline: string;
}
export interface Birthday { date: string; title: string; who?: string }

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

export function holidays(y: number): { date: string; label: string; kind: string; icon: string }[] {
  return [
    { date: ymd(y, 1, 1), label: 'New Year', kind: 'new-year', icon: 'sunrise' },
    { date: ymd(y, 2, 14), label: "Valentine's Day", kind: 'valentine', icon: 'heart' },
    { date: ymd(y, 3, 3), label: 'Hinamatsuri', kind: 'hinamatsuri', icon: 'dolls' },
    { date: easter(y), label: 'Easter', kind: 'easter', icon: 'egg' },
    { date: ymd(y, 5, 5), label: "Children's Day", kind: 'kodomo', icon: 'carp' },
    { date: nthWeekday(y, 5, 0, 2), label: "Mother's Day", kind: 'parents-day', icon: 'flower' },   // same day in JP and US
    { date: nthWeekday(y, 6, 0, 3), label: "Father's Day", kind: 'parents-day', icon: 'flower' },   // same day in JP and US
    { date: ymd(y, 7, 4), label: 'July 4th', kind: 'july4', icon: 'firework' },
    { date: ymd(y, 10, 31), label: 'Halloween', kind: 'halloween', icon: 'pumpkin' },
    { date: nthWeekday(y, 11, 4, 4), label: 'Thanksgiving', kind: 'thanksgiving', icon: 'pie' },
    { date: ymd(y, 12, 25), label: 'Christmas', kind: 'christmas', icon: 'tree' },
  ];
}

const dayNum = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000;

export interface SchoolEvent { date: string; title: string }

/**
 * One countdown per category, each the nearest strictly after `today` (on the
 * day itself the tile has already moved on: "0 days" reads as a mistake):
 * birthday, holiday, school event. A category with nothing ahead is left out —
 * holidays never are, next year's are always ahead. Nearest first; a birthday
 * wins a tie, then the holiday.
 */
export function comingUp(today: string, birthdays: Birthday[], school: SchoolEvent[] = []): Occasion[] {
  const y = Number(today.slice(0, 4));
  const nearest = <T extends { date: string }>(xs: T[]) =>
    xs.filter((x) => x.date > today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const at = (date: string, o: Omit<Occasion, 'days' | 'date'>): Occasion => ({ ...o, days: dayNum(date) - dayNum(today), date });

  const out: Occasion[] = [];
  const b = nearest(birthdays);
  if (b) {
    // A household birthday is labelled with just the name ("days · Sarina").
    const name = b.who ? NAMES[b.who] : undefined;
    out.push(at(b.date, name
      ? { label: name, icon: 'cake', kind: 'birthday', who: b.who, headline: `${name}'s birthday` }
      : { label: b.title, icon: 'cake', kind: 'birthday', headline: b.title }));
  }
  const h = nearest([...holidays(y), ...holidays(y + 1)])!;
  out.push(at(h.date, { label: h.label, icon: h.icon, kind: h.kind, headline: h.label }));
  const s = nearest(school);
  if (s) {
    const kind = schoolKind(s.title) ?? 'school';
    out.push(at(s.date, { label: s.title, icon: KIND_ICON[kind], kind, headline: s.title }));
  }
  // Stable sort: equal dates keep birthday → holiday → school.
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

const KIND_ICON: Record<string, string> = { sports: 'medal', recital: 'music', ceremony: 'cap', school: 'bag' };

// Which calendar events are school events, and which countdown kind each gets
// (CLAUDE.md "Countdown kinds"). Titles are mostly Japanese. Only one-off events
// count (the caller drops recurring ones): a weekly class isn't something to
// count down to.
const SCHOOL: [RegExp, string][] = [
  [/運動会|体育祭|sports ?day|field ?day/i, 'sports'],
  [/発表会|音楽会|学芸会|recital/i, 'recital'],
  [/入学式|卒業式|入園式|卒園式|graduation/i, 'ceremony'],
  [/始業式|終業式|修了式|授業参観|参観日?|遠足|修学旅行|林間学校|臨海学校|保護者会|個人面談|三者面談|学校|field ?trip|parent.?teacher|\bschool\b/i, 'school'],
];
export function schoolKind(title: string): string | undefined {
  return SCHOOL.find(([re]) => re.test(title))?.[1];
}

const NAMES: Record<string, string> = { mariko: 'Mariko', sarina: 'Sarina', nozomi: 'Nozomi', michael: 'Michael' };

/** A calendar event counts as a birthday by its title. */
export const isBirthday = (title: string) => /birthday|b-?day|誕生日/i.test(title);
