// The household's fixed routine, kept here until it lives somewhere Eva can
// change: school departure on weekdays and the girls' bedtime. Merged with the
// calendar by calendar.ts. Pure: takes a Tokyo date, returns what that day holds.
//
// Decided 2026-11-15: leave every weekday at 7:55 regardless of the calendar
// (school holidays don't suppress it); bedtime 20:30 Sun–Thu, 21:00 Fri–Sat.
// Bedtime does not move night mode, which stays at 21:30.

const GIRLS = ['mariko', 'sarina'];

export interface LeaveBy { label: string; who: string[]; at: string }
export interface RoutineEntry { at: string; title: string; who: string[]; sub: string }

/** 0 = Sunday … 6 = Saturday, for a Tokyo date "YYYY-MM-DD". */
export function weekday(date: string): number {
  return new Date(`${date}T12:00:00+09:00`).getUTCDay();
}

export function leaveByFor(date: string): LeaveBy | null {
  const d = weekday(date);
  return d >= 1 && d <= 5 ? { label: 'Leave for school', who: GIRLS, at: '7:55' } : null;
}

export function bedtimeFor(date: string): RoutineEntry {
  const d = weekday(date);
  return { at: d === 5 || d === 6 ? '21:00' : '20:30', title: 'Bedtime', who: GIRLS, sub: '' };
}
