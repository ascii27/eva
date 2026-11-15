import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holidays, isBirthday, nextOccasion } from './occasions.ts';
import { calendarPanels } from './calendar.ts';

test('moving holidays land on the right dates', () => {
  const h = Object.fromEntries(holidays(2026).map((x) => [x.label, x.date]));
  assert.equal(h.Easter, '2026-04-05');
  assert.equal(h["Mother's Day"], '2026-05-10');
  assert.equal(h["Father's Day"], '2026-06-21');
  assert.equal(h.Thanksgiving, '2026-11-26');
  assert.equal(holidays(2027).find((x) => x.label === 'Easter')!.date, '2027-03-28');
});

test('the nearest occasion strictly after today; birthdays win ties; wraps the year', () => {
  assert.deepEqual(nextOccasion('2026-11-15', []), { label: 'Thanksgiving', days: 11, icon: 'gift', date: '2026-11-26' });
  assert.equal(nextOccasion('2026-11-26', []).label, 'Christmas');            // on the day, it has moved on
  assert.deepEqual(nextOccasion('2026-12-25', []), { label: 'New Year', days: 7, icon: 'gift', date: '2027-01-01' });
  const bd = [{ date: '2026-11-20', title: "Sarina's birthday" }];
  assert.equal(nextOccasion('2026-11-15', bd).label, "Sarina's birthday");
  assert.equal(nextOccasion('2026-11-15', [{ date: '2026-11-26', title: 'まりこ誕生日' }]).label, 'まりこ誕生日');
  assert.ok(isBirthday('Mariko Birthday') && isBirthday('さりな誕生日') && !isBirthday('Birds day out'));
});

test('a yearly birthday in the calendar beats a later holiday', () => {
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'UID:b1', 'DTSTART;VALUE=DATE:20150318', 'DTEND;VALUE=DATE:20150319', 'RRULE:FREQ=YEARLY', "SUMMARY:Sarina's Birthday", 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:b2', 'DTSTART;VALUE=DATE:20180213', "SUMMARY:James' First Birthday", 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const p = calendarPanels(ics, new Date('2027-03-10T09:00:00+09:00'));
  assert.deepEqual(p.occasion, { label: "Sarina's Birthday", days: 8, icon: 'gift', date: '2027-03-18' });
  // A one-off birthday years ago doesn't recur; Hinamatsuri (3 Mar) is ahead here.
  assert.equal(calendarPanels(ics, new Date('2027-02-10T09:00:00+09:00')).occasion.label, 'Hinamatsuri');
});
