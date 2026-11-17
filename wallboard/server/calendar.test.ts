import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calendarPanels, httpsUrl, iconOf, parsePeople, personOf, whoFor, whoOf } from './calendar.ts';

// Synthetic feed — never the family's real calendar.
const LA = `BEGIN:VTIMEZONE
TZID:America/Los_Angeles
BEGIN:DAYLIGHT
TZOFFSETFROM:-0800
TZOFFSETTO:-0700
DTSTART:20070311T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
TZNAME:PDT
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0700
TZOFFSETTO:-0800
DTSTART:20071104T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
TZNAME:PST
END:STANDARD
END:VTIMEZONE`;
const TOKYO = `BEGIN:VTIMEZONE
TZID:Asia/Tokyo
BEGIN:STANDARD
TZOFFSETFROM:+0900
TZOFFSETTO:+0900
DTSTART:19700101T000000
TZNAME:JST
END:STANDARD
END:VTIMEZONE`;
const ev = (lines: string) => `BEGIN:VEVENT\nDTSTAMP:20260101T000000Z\n${lines}\nEND:VEVENT`;
const cal = (...parts: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:test', LA, TOKYO, ...parts, 'END:VCALENDAR'].join('\r\n');

const at = (iso: string) => new Date(`${iso}+09:00`);
/** The calendar's own entries, without the routine's Bedtime. */
const calOnly = (p: { schedule: { title: string }[] }) => p.schedule.filter((e) => e.title !== 'Bedtime');

test('timed events today, in Tokyo time, sorted; all-day first', () => {
  const ics = cal(
    ev('UID:b\nDTSTART;TZID=Asia/Tokyo:20261116T150000\nDTEND;TZID=Asia/Tokyo:20261116T160000\nSUMMARY:さりな ピアノ\nLOCATION:Music school\\n1-2-3 Ikejiri'),
    ev('UID:a\nDTSTART;TZID=Asia/Tokyo:20261116T093000\nDTEND;TZID=Asia/Tokyo:20261116T100000\nSUMMARY:Dentist'),
    ev('UID:c\nDTSTART;VALUE=DATE:20261116\nDTEND;VALUE=DATE:20261117\nSUMMARY:キッズ振替休業'),
    ev('UID:d\nDTSTART;TZID=Asia/Tokyo:20261117T073000\nDTEND;TZID=Asia/Tokyo:20261117T090000\nSUMMARY:Not today'),
  );
  const p = calendarPanels(ics, at('2026-11-16T07:00:00'));
  assert.deepEqual(calOnly(p), [
    { id: '2026-11-16-allday-キッズ振替休業', start: null, allDay: true, title: 'キッズ振替休業', who: ['mariko', 'sarina'], icon: 'calendar', sub: '' },
    { id: '2026-11-16-9:30-Dentist', start: '9:30', end: '10:00', title: 'Dentist', who: [], icon: 'tooth', sub: '' },
    { id: '2026-11-16-15:00-さりな ピアノ', start: '15:00', end: '16:00', title: 'さりな ピアノ', who: ['sarina'], icon: 'music', sub: 'Music school' },
  ]);
  // Tomorrow is a list: its events with the 7:55 school run among them, in order.
  assert.deepEqual(p.tomorrow.map((e) => `${e.start} ${e.title}`), ['7:30 Not today', '7:55 School']);
  assert.deepEqual(p.tomorrow[1], { id: 'school-2026-11-17', start: '7:55', title: 'School', who: ['mariko', 'sarina'], icon: 'bag', sub: '' });
});

test('multi-day all-day events cover each day up to, not including, DTEND', () => {
  const ics = cal(ev('UID:t\nDTSTART;VALUE=DATE:20261130\nDTEND;VALUE=DATE:20261203\nSUMMARY:まりこ trip'));
  for (const d of ['2026-11-30', '2026-12-01', '2026-12-02']) assert.equal(calOnly(calendarPanels(ics, at(`${d}T12:00:00`))).length, 1, d);
  assert.equal(calOnly(calendarPanels(ics, at('2026-12-03T12:00:00'))).length, 0);
  assert.equal(calOnly(calendarPanels(ics, at('2026-11-29T12:00:00'))).length, 0);
});

test('a Los Angeles event lands on the right Tokyo day and hour, across US DST', () => {
  // Tue 16:00 in LA = Wed 08:00 Tokyo in PDT, Wed 09:00 in PST.
  const ics = cal(ev('UID:g\nDTSTART;TZID=America/Los_Angeles:20261013T160000\nDTEND;TZID=America/Los_Angeles:20261013T165000\nRRULE:FREQ=WEEKLY\nSUMMARY:Gym'));
  assert.deepEqual(calOnly(calendarPanels(ics, at('2026-10-14T07:00:00'))).map((e: any) => e.start), ['8:00']);
  assert.deepEqual(calOnly(calendarPanels(ics, at('2026-11-11T07:00:00'))).map((e: any) => e.start), ['9:00']);
  assert.equal(calOnly(calendarPanels(ics, at('2026-11-10T07:00:00'))).length, 0);   // the LA Tuesday is not a Tokyo Tuesday
});

test('recurrence honours UNTIL, EXDATE, moved and cancelled occurrences', () => {
  const ics = cal(
    ev('UID:w\nDTSTART;TZID=Asia/Tokyo:20261102T170000\nDTEND;TZID=Asia/Tokyo:20261102T180000\nRRULE:FREQ=WEEKLY;UNTIL=20261207T000000Z\nEXDATE;TZID=Asia/Tokyo:20261109T170000\nSUMMARY:Swim'),
    ev('UID:w\nRECURRENCE-ID;TZID=Asia/Tokyo:20261116T170000\nDTSTART;TZID=Asia/Tokyo:20261116T183000\nDTEND;TZID=Asia/Tokyo:20261116T193000\nSUMMARY:Swim (late)'),
    ev('UID:w\nRECURRENCE-ID;TZID=Asia/Tokyo:20261123T170000\nDTSTART;TZID=Asia/Tokyo:20261123T170000\nDTEND;TZID=Asia/Tokyo:20261123T180000\nSTATUS:CANCELLED\nSUMMARY:Swim'),
  );
  const on = (d: string) => calOnly(calendarPanels(ics, at(`${d}T07:00:00`))).map((e: any) => `${e.start} ${e.title}`);
  assert.deepEqual(on('2026-11-02'), ['17:00 Swim']);
  assert.deepEqual(on('2026-11-09'), []);
  assert.deepEqual(on('2026-11-16'), ['18:30 Swim (late)']);
  assert.deepEqual(on('2026-11-23'), []);
  assert.deepEqual(on('2026-11-30'), ['17:00 Swim']);
  assert.deepEqual(on('2026-12-07'), []);
});

test('floating times are Tokyo, not the server\'s zone; nothing tomorrow is an empty list', () => {
  const ics = cal(ev('UID:f\nDTSTART:20261116T100000\nDTEND:20261116T110000\nSUMMARY:Floating'));
  // A Saturday, so there's no school run tomorrow (Sunday) either.
  const ics2 = cal(ev('UID:f\nDTSTART:20261121T100000\nDTEND:20261121T110000\nSUMMARY:Floating'));
  assert.deepEqual(calOnly(calendarPanels(ics, at('2026-11-16T07:00:00'))).map((e: any) => e.start), ['10:00']);
  assert.deepEqual(calendarPanels(ics2, at('2026-11-21T07:00:00')).tomorrow, []);
});

test('iconOf guesses from the title, falling back to a calendar', () => {
  assert.equal(iconOf('まりこ スイミング'), 'swim');
  assert.equal(iconOf('のぞみ お迎え'), 'car');
  assert.equal(iconOf('チア@下北沢'), 'calendar');
});

test('whoOf reads names in kana and romaji; httpsUrl rewrites webcal', () => {
  assert.deepEqual(whoOf('マリコとのぞみ 買い物'), ['mariko', 'nozomi']);
  assert.deepEqual(whoOf('Sarina swim'), ['sarina']);
  assert.deepEqual(whoOf('チア@下北沢'), []);
  assert.equal(httpsUrl('webcal://p1-caldav.icloud.com/published/2/x'), 'https://p1-caldav.icloud.com/published/2/x');
});

test('who comes from the invitees (ASC-30): by name, by address, minus the organizer and anyone who declined', () => {
  const ics = cal(
    // Nozomi made it and invited Sarina: it is Sarina's, not Nozomi's.
    ev('UID:i1\nDTSTART;TZID=Asia/Tokyo:20261116T150000\nDTEND;TZID=Asia/Tokyo:20261116T160000\nSUMMARY:チア@下北沢\nORGANIZER;CN=Nozomi:mailto:mom@example.com\nATTENDEE;CN=Nozomi;PARTSTAT=ACCEPTED:mailto:mom@example.com\nATTENDEE;CN=Sarina G;PARTSTAT=NEEDS-ACTION:mailto:s123@example.com'),
    // Two girls invited, Michael declined; one invitee is only an address, mapped by CALENDAR_PEOPLE.
    ev('UID:i2\nDTSTART;TZID=Asia/Tokyo:20261116T170000\nDTEND;TZID=Asia/Tokyo:20261116T180000\nSUMMARY:Dinner out\nATTENDEE;CN=Michael;PARTSTAT=DECLINED:mailto:dad@example.com\nATTENDEE:mailto:mariko.g@example.com\nATTENDEE:mailto:kid2@example.com'),
    // No invitees: the title still decides, and nobody named means nobody.
    ev('UID:i3\nDTSTART;TZID=Asia/Tokyo:20261116T190000\nDTEND;TZID=Asia/Tokyo:20261116T193000\nSUMMARY:さりな ピアノ'),
    ev('UID:i4\nDTSTART;TZID=Asia/Tokyo:20261116T193000\nDTEND;TZID=Asia/Tokyo:20261116T200000\nSUMMARY:Delivery'),
  );
  const people = parsePeople('KID2@example.com=sarina, mailto:gran@example.com=grandma');
  const who = calOnly(calendarPanels(ics, at('2026-11-16T07:00:00'), people)).map((e: any) => `${e.title}: ${e.who.join('+')}`);
  assert.deepEqual(who, ['チア@下北沢: sarina', 'Dinner out: mariko+sarina', 'さりな ピアノ: sarina', 'Delivery: ']);
});

test('whoFor merges title and invitees in household order; personOf skips ambiguous names', () => {
  assert.deepEqual(whoFor('まりこ swim', [{ name: 'Sarina', email: 'x@y' }]), ['mariko', 'sarina']);
  assert.deepEqual(whoFor('Visit', [{ name: '', email: 'gran@example.com' }], parsePeople('gran@example.com=grandma')), ['grandma']);
  assert.equal(personOf({ name: 'Mariko & Sarina', email: 'shared@example.com' }), null);
  assert.equal(personOf({ name: '', email: 'unknown@example.com' }), null);
});

test('routine: leave at 7:55 Mon–Fri only, bedtime 20:30 Sun–Thu and 21:00 Fri–Sat, timed in order', () => {
  // 2026-11-15 is a Sunday.
  const days = ['15', '16', '17', '18', '19', '20', '21'].map((d) => calendarPanels(null, at(`2026-11-${d}T06:00:00`)));
  assert.deepEqual(days.map((p) => p['leave-by']?.at ?? null), [null, '7:55', '7:55', '7:55', '7:55', '7:55', null]);
  assert.deepEqual(days[1]['leave-by'], { label: 'Leave for school', who: ['mariko', 'sarina'], at: '7:55' });
  assert.deepEqual(days.map((p) => p.schedule.find((e) => e.id === 'bedtime')?.start), ['20:30', '20:30', '20:30', '20:30', '20:30', '21:00', '21:00']);
  assert.deepEqual(days.map((p) => p.bedtime.at), ['20:30', '20:30', '20:30', '20:30', '20:30', '21:00', '21:00']);
  assert.deepEqual(days[5].bedtime, { label: 'Bedtime', who: ['mariko', 'sarina'], at: '21:00' });
  // Tomorrow: the school run on school nights (Sun–Thu), nothing before a weekend; never bedtime.
  assert.deepEqual(days.map((p) => p.tomorrow.map((e) => e.title).join() || null), ['School', 'School', 'School', 'School', 'School', null, null]);
  // Bedtime sorts among the timed events, after all-day ones.
  const ics = cal(
    ev('UID:x\nDTSTART;TZID=Asia/Tokyo:20261116T210000\nDTEND;TZID=Asia/Tokyo:20261116T220000\nSUMMARY:Late call'),
    ev('UID:y\nDTSTART;VALUE=DATE:20261116\nDTEND;VALUE=DATE:20261117\nSUMMARY:Holiday'),
  );
  assert.deepEqual(calendarPanels(ics, at('2026-11-16T06:00:00')).schedule.map((e) => e.start ?? 'all day'), ['all day', '20:30', '21:00']);
});
