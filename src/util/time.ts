/** HH:MM wall-clock label shared by the side column, transcript, and wake log. */
export function hhmm(at: Date | number = new Date()): string {
  const d = typeof at === 'number' ? new Date(at) : at;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
