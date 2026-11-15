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
    note: { text: 'Rain after 6 pm. Swim bag needs the spare towel tonight.', sub: 'Also: library books due Wednesday.' },

    weather: {
      now: { cond: 'sun', temp: 14, label: 'Sunny' },
      summary: 'High 19° · rain from 18:00',
      hourly: [
        { time: '10:00', cond: 'sun', temp: 16 },
        { time: '13:00', cond: 'sun', temp: 19 },
        { time: '16:00', cond: 'cloud', temp: 17 },
        { time: '19:00', cond: 'rain', temp: 13 },
        { time: '22:00', cond: 'rain', temp: 11 },
      ],
      night: { cond: 'clear-night', text: '9° clear · rain clears by morning' },
    },

    'leave-by': { label: 'Leave for school', who: ['mariko', 'sarina'], at: '7:55' },

    pickup: { text: 'Swim · 16:30 · Nozomi' },

    dinner: { at: '18:30', text: 'Curry rice' },

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
