import { test } from 'node:test';
import assert from 'node:assert/strict';
import { condOf, labelOf, weatherPanel, type Forecast } from './weather.ts';

/** Two days of hourly data from 00:00 today; `wx(i)` gives [code, prob, temp] for hour index i. */
function forecast(nowIso: string, nowCode: number, wx: (i: number) => [number, number, number]): Forecast {
  const time: string[] = [], temp: number[] = [], code: number[] = [], prob: number[] = [], isDay: number[] = [];
  for (let i = 0; i < 48; i++) {
    const d = i < 24 ? '2026-11-16' : '2026-11-17';
    const h = i % 24;
    time.push(`${d}T${String(h).padStart(2, '0')}:00`);
    const [c, p, t] = wx(i);
    code.push(c); prob.push(p); temp.push(t); isDay.push(h >= 6 && h < 17 ? 1 : 0);
  }
  const h = Number(nowIso.slice(11, 13));
  return {
    current: { time: nowIso, temperature_2m: 14.4, weather_code: nowCode, is_day: h >= 6 && h < 17 ? 1 : 0 },
    hourly: { time, temperature_2m: temp, weather_code: code, precipitation_probability: prob, is_day: isDay },
    daily: { time: ['2026-11-16', '2026-11-17'], temperature_2m_max: [19.2, 16.6], temperature_2m_min: [9.4, 8.1], weather_code: [61, 3] },
  };
}

test('morning, dry now, rain later: names the hour it starts', () => {
  const p = weatherPanel(forecast('2026-11-16T07:45', 0, (i) => (i >= 18 ? [61, 80, 13] : [1, 10, 15])));
  assert.deepEqual(p.now, { cond: 'sun', temp: 14, label: 'Sunny' });
  assert.equal(p.summary, 'High 19° · rain from 18:00');
  assert.deepEqual(p.hourly.map((x) => x.time), ['8:00', '11:00', '14:00', '17:00', '20:00']);
  assert.equal(p.hourly[4].cond, 'rain');
});

test('a high precipitation probability counts as rain even on a cloudy code', () => {
  const p = weatherPanel(forecast('2026-11-16T09:10', 3, (i) => (i === 15 ? [3, 60, 15] : [3, 10, 15])));
  assert.equal(p.summary, 'High 19° · rain from 15:00');
});

test('dry all day: gives the low instead', () => {
  const p = weatherPanel(forecast('2026-11-16T09:10', 2, () => [2, 0, 15]));
  assert.equal(p.summary, 'High 19° · low 9°');
  assert.equal(p.now.label, 'Partly cloudy');
});

test('raining now: says when it dries up, or that it won\'t', () => {
  assert.equal(weatherPanel(forecast('2026-11-16T13:20', 63, (i) => (i >= 16 ? [3, 10, 14] : [63, 90, 14]))).summary, 'High 19° · dry from 16:00');
  assert.equal(weatherPanel(forecast('2026-11-16T08:00', 63, () => [63, 90, 14])).summary, 'High 19° · rain all day');
  assert.equal(weatherPanel(forecast('2026-11-16T18:15', 63, () => [63, 90, 14])).summary, 'High 19° · rain all evening');
});

test('hourly crosses midnight; night text looks at tomorrow in the evening, today after midnight', () => {
  const eve = weatherPanel(forecast('2026-11-16T22:05', 1, () => [1, 0, 10]));
  assert.deepEqual(eve.hourly.map((x) => x.time), ['23:00', '2:00', '5:00', '8:00', '11:00']);
  assert.deepEqual(eve.night, { cond: 'clear-night', text: '14° mostly clear · tomorrow cloudy, high 17°' });
  const late = weatherPanel(forecast('2026-11-16T02:30', 1, () => [1, 0, 10]));
  assert.equal(late.night.text, '14° mostly clear · today light rain, high 19°');
});

test('codes map onto the board\'s four icons', () => {
  assert.equal(condOf(0, false), 'clear-night');
  assert.equal(condOf(45, true), 'cloud');
  assert.equal(condOf(81, true), 'rain');
  assert.equal(condOf(95, true), 'rain');
  assert.equal(condOf(73, true), 'cloud');
  assert.equal(labelOf(73, true), 'Snow');
});
