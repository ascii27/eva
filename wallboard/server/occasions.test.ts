import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comingUp, holidays, isBirthday, schoolKind } from './occasions.ts';
import { calendarPanels } from './calendar.ts';

test('moving holidays land on the right dates', () => {
  const h = Object.fromEntries(holidays(2026).map((x) => [x.label, x.date]));
  assert.equal(h.Easter, '2026-04-05');
  assert.equal(h["Mother's Day"], '2026-05-10');
  assert.equal(h["Father's Day"], '2026-06-21');
  assert.equal(h.Thanksgiving, '2026-11-26');
  assert.equal(holidays(2027).find((x) => x.label === 'Easter')!.date, '2027-03-28');
});

const labels = (xs: { label: string }[]) => xs.map((x) => x.label);

test('one per category, each strictly after today, nearest first; wraps the year', () => {
  assert.deepEqual(comingUp('2026-11-15', []), [{ label: 'Thanksgiving', days: 11, icon: 'pie', date: '2026-11-26', kind: 'thanksgiving', headline: 'Thanksgiving' }]);
  assert.deepEqual(labels(comingUp('2026-11-26', [])), ['Christmas']);            // on the day, it has moved on
  assert.equal(comingUp('2026-12-25', [])[0].date, '2027-01-01');
  assert.equal(comingUp('2026-12-25', [])[0].days, 7);
  const bd = [{ date: '2026-11-20', title: "Sarina's birthday" }];
  assert.deepEqual(labels(comingUp('2026-11-15', bd)), ["Sarina's birthday", 'Thanksgiving']);   // no who: the title
  assert.deepEqual(comingUp('2026-11-15', [{ ...bd[0], who: 'sarina' }])[0],
    { label: 'Sarina', icon: 'cake', kind: 'birthday', who: 'sarina', headline: "Sarina's birthday", days: 5, date: '2026-11-20' });
  assert.ok(isBirthday('Mariko Birthday') && isBirthday('さりな誕生日') && !isBirthday('Birds day out'));
});

test('the nearest birthday is always in, even after the holiday', () => {
  const bd = [{ date: '2027-03-18', title: 'Sarina', who: 'sarina' }, { date: '2027-06-01', title: 'Later' }];
  assert.deepEqual(labels(comingUp('2026-11-15', bd)), ['Thanksgiving', 'Sarina']);
  // A tie: birthday first.
  assert.deepEqual(labels(comingUp('2026-11-15', [{ date: '2026-11-26', title: 'まりこ誕生日' }])), ['まりこ誕生日', 'Thanksgiving']);
  // Past birthdays don't count.
  assert.deepEqual(labels(comingUp('2026-11-15', [{ date: '2026-11-10', title: 'x' }])), ['Thanksgiving']);
});

test('the nearest school event joins with its kind', () => {
  const school = [{ date: '2026-12-02', title: '遠足' }, { date: '2026-11-21', title: 'さりな 音楽会' }, { date: '2026-11-01', title: '運動会' }];
  const c = comingUp('2026-11-15', [], school);
  assert.deepEqual(labels(c), ['さりな 音楽会', 'Thanksgiving']);
  assert.deepEqual(c[0], { label: 'さりな 音楽会', icon: 'music', kind: 'recital', headline: 'さりな 音楽会', days: 6, date: '2026-11-21' });
});

test('school event kinds from titles', () => {
  assert.equal(schoolKind('運動会'), 'sports');
  assert.equal(schoolKind('Sports Day'), 'sports');
  assert.equal(schoolKind('ピアノ発表会'), 'recital');
  assert.equal(schoolKind('まりこ 卒業式'), 'ceremony');
  assert.equal(schoolKind('授業参観'), 'school');
  assert.equal(schoolKind('School trip'), 'school');
  assert.equal(schoolKind('Schoolhouse Rock'), undefined);
  assert.equal(schoolKind('水泳'), undefined);
});

test('a yearly birthday in the calendar joins the rotation', () => {
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'UID:b1', 'DTSTART;VALUE=DATE:20150318', 'DTEND;VALUE=DATE:20150319', 'RRULE:FREQ=YEARLY', "SUMMARY:Sarina's Birthday", 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:b2', 'DTSTART;VALUE=DATE:20180213', "SUMMARY:James' First Birthday", 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const p = calendarPanels(ics, new Date('2027-03-10T09:00:00+09:00'));
  assert.deepEqual(p.occasions[0], { label: 'Sarina', icon: 'cake', kind: 'birthday', who: 'sarina', headline: "Sarina's birthday", days: 8, date: '2027-03-18' });
  assert.deepEqual(labels(p.occasions), ['Sarina', 'Easter']);
  // A one-off birthday years ago doesn't recur; Valentine's Day (14 Feb) is ahead here, and Sarina still rides along.
  assert.deepEqual(labels(calendarPanels(ics, new Date('2027-02-10T09:00:00+09:00')).occasions), ["Valentine's Day", 'Sarina']);
  assert.deepEqual(labels(calendarPanels(ics, new Date('2027-02-20T09:00:00+09:00')).occasions), ['Hinamatsuri', 'Sarina']);
});

test('school events come from one-off calendar events only', () => {
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'BEGIN:VEVENT', 'UID:s1', 'DTSTART;VALUE=DATE:20261120', 'RRULE:FREQ=WEEKLY', 'SUMMARY:学校 クラブ', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:s2', 'DTSTART;TZID=Asia/Tokyo:20261203T090000', 'DTEND;TZID=Asia/Tokyo:20261203T120000', 'SUMMARY:キッズ 授業参観', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const p = calendarPanels(ics, new Date('2026-11-16T09:00:00+09:00'));
  assert.deepEqual(labels(p.occasions), ['Thanksgiving', 'キッズ 授業参観']);
  assert.equal(p.occasions[1].kind, 'school');
  assert.equal(p.occasions[1].icon, 'bag');
});
