// DUMMY CONTENT — stands in for everything Eva doesn't push yet, so the
// experience can be tried end to end. Each key here is overridden by the panel
// of the same name the moment hermes pushes one (see `content()` in app.js), so
// this file shrinks as the integration grows.
//
// Times are "H:MM" in the board's local day. The schedule and tomorrow are
// the sample day from design/DayFlow.dc.html, so ?time=7:42 / 15:40 / 19:30
// reproduce its three moments.

export function dummy() {
  return {
    // Eva's bubble. Unlike the rest of this file it is NOT a fallback: an absent
    // `eva` panel means she has nothing to say. Only ?eva=new shows this one.
    eva: { text: 'Rain after 3 — umbrellas by the door!', sub: 'Swim bag needs the spare towel.', mood: 'happy' },

    weather: {
      now: { cond: 'sun', temp: 14, label: 'Sunny' },
      high: 19,
      low: 11,
      ahead: 'Sunny now · rain from 18:00',
      hourly: [
        { time: '10:00', cond: 'sun', temp: 16 },
        { time: '13:00', cond: 'partly', temp: 19 },
        { time: '16:00', cond: 'cloudy', temp: 17 },
        { time: '19:00', cond: 'rain', temp: 13 },
        { time: '22:00', cond: 'rain', temp: 11 },
      ],
      daily: [
        { day: 'Wed', cond: 'rain', high: 15, low: 9 },
        { day: 'Thu', cond: 'cloudy', high: 16, low: 8 },
        { day: 'Fri', cond: 'sun', high: 18, low: 9 },
        { day: 'Sat', cond: 'partly', high: 17, low: 10 },
        { day: 'Sun', cond: 'sun', high: 19, low: 11 },
      ],
      night: { cond: 'night', text: '9° clear · rain clears by morning' },
    },

    'leave-by': { label: 'Leave for school', who: ['mariko', 'sarina'], at: '7:55' },

    pickup: { text: 'Swim · 16:30 · Nozomi' },

    countdowns: [
      { label: 'Grandma', headline: 'Grandma comes', days: 12, icon: 'gift', kind: 'visit' },
      { label: 'Winter break', days: 38 },
    ],

    // Shape (CLAUDE.md "Data"): { id, who, start, end?, title, icon, bring? }.
    schedule: [
      { id: 'office', who: ['michael'], start: '9:30', title: 'Office', icon: 'work' },
      { id: 'dentist', who: ['nozomi'], start: '11:00', title: 'Dentist', icon: 'tooth' },
      { id: 'piano', who: ['sarina'], start: '15:00', title: 'Piano', icon: 'music' },
      { id: 'swim', who: ['mariko'], start: '16:30', title: 'Swim', icon: 'swim',
        bring: [{ icon: 'bag', label: 'Swim bag' }, { icon: 'towel', label: 'Spare towel' }] },
      { id: 'pickup', who: ['nozomi'], start: '16:30', title: 'Pickup', icon: 'car' },
    ],

    tomorrow: [
      { id: 't-school', who: ['mariko', 'sarina'], start: '7:55', title: 'School', icon: 'bag',
        bring: [{ icon: 'recorder', label: 'Recorder' }] },
      { id: 't-office', who: ['michael'], start: '9:00', title: 'Office', icon: 'work' },
      { id: 't-tennis', who: ['mariko'], start: '17:00', title: 'Tennis', icon: 'tennis',
        bring: [{ icon: 'tennis', label: 'Tennis kit' }] },
    ],

    memories: [
      { src: '/assets/memory-placeholder.svg', caption: 'Beach day, August 2025', w: 1920, h: 1080 },
      { src: '/assets/portrait-a.svg', caption: 'Placeholder portrait', w: 810, h: 1080 },
      { src: '/assets/portrait-b.svg', caption: 'Placeholder portrait', w: 810, h: 1080 },
    ],
  };
}

// Seed for the chore list, pushed through the real hermes API by
// `npm run seed` so chores exercise the real server path.
export const SEED_CHORES = [
  { id: 'ma-bed', title: 'Make bed', who: 'mariko', icon: 'bed' },
  { id: 'ma-bag', title: 'Pack school bag', who: 'mariko', icon: 'bag' },
  { id: 'ma-table', title: 'Set the table', who: 'mariko', icon: 'table' },
  { id: 'ma-shoes', title: 'Tidy shoes', who: 'mariko', icon: 'shoes' },
  { id: 'sa-bed', title: 'Make bed', who: 'sarina', icon: 'bed' },
  { id: 'sa-bag', title: 'Pack school bag', who: 'sarina', icon: 'bag' },
  { id: 'sa-laundry', title: 'Put away laundry', who: 'sarina', icon: 'laundry' },
  { id: 'sa-plants', title: 'Water plants', who: 'sarina', icon: 'plants' },
];

// A sample `month` panel (ASC-41) around `today` ("YYYY-MM-DD"): the same
// people and kinds of events as the sample day, repeating through last, this
// and next month, so the month sheet can be tried without a calendar.
export function dummyMonth(today) {
  const [y, m] = today.split('-').map(Number);
  const first = Date.UTC(y, m - 2, 1), end = Date.UTC(y, m + 1, 1);
  const weekly = [
    [1, { start: '9:00', end: '18:00', title: 'Office', who: ['michael'], icon: 'work' }],
    [2, { start: '17:00', end: '18:00', title: 'Swim', who: ['sarina'], icon: 'swim' }],
    [3, { start: '16:00', end: '16:45', title: 'Piano', who: ['mariko'], icon: 'music' }],
    [3, { start: '9:00', end: '18:00', title: 'Office', who: ['michael'], icon: 'work' }],
    [5, { start: '17:00', end: '18:30', title: 'Tennis', who: ['mariko'], icon: 'tennis' }],
    [6, { start: '10:00', end: '12:00', title: 'Family lunch', who: [], icon: 'calendar' }],
  ];
  const out = [];
  for (let t = first; t < end; t += 86_400_000) {
    const d = new Date(t);
    const date = d.toISOString().slice(0, 10);
    const dom = d.getUTCDate();
    if (dom >= 12 && dom <= 14) out.push({ date, start: null, allDay: true, title: 'School trip', who: ['mariko'], icon: 'calendar' });
    if (dom === 20) out.push({ date, start: null, allDay: true, title: 'Sports day', who: ['mariko', 'sarina'], icon: 'calendar' });
    if (dom === 8) out.push({ date, start: '15:30', end: '16:00', title: 'Dentist', who: ['nozomi', 'sarina'], icon: 'tooth' });
    if (dom === 18) out.push({ date, start: '19:00', end: '21:00', title: 'Dinner with friends', who: ['nozomi'], icon: 'calendar' });
    for (const [wd, e] of weekly) if (d.getUTCDay() === wd) out.push({ date, ...e });
  }
  const key = (e) => (e.allDay ? -1 : Number(e.start.split(':')[0]) * 60 + Number(e.start.split(':')[1]));
  return out.sort((a, b) => a.date.localeCompare(b.date) || key(a) - key(b));
}
