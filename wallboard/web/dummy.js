// DUMMY CONTENT — stands in for everything Eva doesn't push yet, so the
// experience can be tried end to end. Each key here is overridden by the panel
// of the same name the moment hermes pushes one (see `content()` in app.js), so
// this file shrinks as the integration grows.
//
// Times are "H:MM" in the board's local day. The leave-by time is relative to
// page load so the countdown card is always there to try; real data won't be.

function inMinutes(start, n) {
  const d = new Date(start.getTime() + n * 60_000);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** `start` is the board's notion of now, which ?time= can fake. */
export function dummy(start = new Date()) {
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

    'leave-by': { label: 'Leave for school', who: ['mariko', 'sarina'], at: inMinutes(start, 13) },

    pickup: { text: 'Swim · 16:30 · Nozomi' },

    dinner: { at: '18:30', text: 'Curry rice' },

    countdowns: [
      { label: 'Grandma', headline: 'Grandma comes', days: 12, icon: 'gift', kind: 'visit' },
      { label: 'Winter break', days: 38 },
    ],

    schedule: [
      { at: '9:30', title: 'Office', who: ['michael'], sub: 'Michael · back 18:00' },
      { at: '11:00', title: 'Dentist', who: ['nozomi'], sub: 'Nozomi' },
      { at: '15:00', title: 'Piano lesson', who: ['sarina'], sub: 'Sarina · walks home' },
      { at: '16:30', title: 'Swim · pickup', who: ['mariko', 'nozomi'], sub: 'Nozomi picks up' },
      { at: '18:30', title: 'Family dinner', who: [], sub: 'Everyone home' },
      { at: '20:00', title: 'Bath & bedtime', who: [], sub: '{bath} first tonight' },
    ],

    tomorrow: { at: '7:55', title: 'Tomorrow · leave for school' },

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
