// The time and date, phrased the way a person says them out loud.
//
// Eva reads the tool's result back aloud, so the formatting matters more than
// it looks: an ISO stamp or a 24-hour clock is something she might parrot, and
// neither is listenable. The formatter is pure so that is testable; only
// `runClock` touches the actual wall clock.

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Where the hour sits in the day. Boundaries are conversational rather than
 * astronomical — 4am reads as night, 5am as morning.
 */
function partOfDay(hour: number): string {
  if (hour < 5) return 'at night';
  if (hour < 12) return 'in the morning';
  if (hour < 17) return 'in the afternoon';
  if (hour < 21) return 'in the evening';
  return 'at night';
}

export function formatClock(now: Date): string {
  const hour24 = now.getHours();
  const minute = now.getMinutes();
  const date = `${WEEKDAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;

  // The two hours that have names of their own; saying "12:00 in the
  // afternoon" out loud is worse than saying "noon".
  if (minute === 0 && hour24 === 0) return `${date}, midnight`;
  if (minute === 0 && hour24 === 12) return `${date}, noon`;

  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${date}, ${hour12}:${String(minute).padStart(2, '0')} ${partOfDay(hour24)}`;
}
