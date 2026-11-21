// Real weather for the board: Open-Meteo (free, no key; JMA models for Japan),
// polled by the server and published as the `weather` panel, the same shape
// web/dummy.js has always rendered. The server owns this panel — a hermes push
// to `weather` would be overwritten on the next poll.
//
// Pure conversion + a thin poller, the split state.ts uses. The conversion takes
// "now" from the response's own `current.time`, which is already local
// (timezone=Asia/Tokyo), so the VM's clock and timezone never enter into it.

export interface Forecast {
  current: { time: string; temperature_2m: number; weather_code: number; is_day: number; wind_gusts_10m?: number | null };
  hourly: { time: string[]; temperature_2m: number[]; weather_code: number[]; precipitation_probability: (number | null)[]; is_day: number[]; wind_gusts_10m?: (number | null)[] };
  daily: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; weather_code: number[] };
}

/** The panel the board renders (see renderAmbient / renderActive / renderNight in app.js). */
export interface WeatherPanel {
  now: { cond: string; temp: number; label: string };
  /** Today's high and low, for the card's ↑ / ↓. */
  high: number;
  low: number;
  /** One line of what's coming ("Sunny now · rain from 15:00", "Rain until 22:00"). */
  ahead: string;
  hourly: { time: string; cond: string; temp: number }[];
  night: { cond: string; text: string };
}

// Ikejiri, Setagaya-ku.
export const IKEJIRI = { lat: 35.6505, lon: 139.6835 };

const RAINY = (c: number) => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95;
const SNOWY = (c: number) => (c >= 71 && c <= 77) || c === 85 || c === 86;
const STORMY = (c: number) => c >= 95;
/** Wet enough to mention: the code says so, or it's more likely than not. */
const wet = (code: number, prob: number | null) => RAINY(code) || SNOWY(code) || (prob ?? 0) >= 50;

/** Gusts at or above this (km/h) make a dry hour `wind` (CLAUDE.md "Weather: top-right card"). */
export const BREEZY_KMH = 35;

/**
 * WMO code → the board's icon keys (web/icons.js `weatherIcon`): sun, partly,
 * cloudy, fog, rain, snow, storm, wind, and after sunset night / night-cloud.
 * `wind` replaces the sky only when nothing wetter is happening.
 */
export function condOf(code: number, isDay: boolean, gusts: number | null = null): string {
  if (STORMY(code)) return 'storm';
  if (SNOWY(code)) return 'snow';
  if (RAINY(code)) return 'rain';
  if ((gusts ?? 0) >= BREEZY_KMH) return 'wind';
  if (code === 0) return isDay ? 'sun' : 'night';
  if (code <= 2) return isDay ? 'partly' : 'night-cloud';
  if (code === 45 || code === 48) return 'fog';
  return 'cloudy';
}

export function labelOf(code: number, isDay: boolean): string {
  if (code === 0) return isDay ? 'Sunny' : 'Clear';
  if (code === 1) return isDay ? 'Mostly sunny' : 'Mostly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Cloudy';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code === 61 || code === 80) return 'Light rain';
  if (code === 63 || code === 81) return 'Rain';
  if (code === 65 || code === 82) return 'Heavy rain';
  if (code === 66 || code === 67) return 'Freezing rain';
  if (SNOWY(code)) return 'Snow';
  if (code >= 95) return 'Thunderstorms';
  return 'Cloudy';
}

const hourOf = (iso: string) => Number(iso.slice(11, 13));
const hm = (iso: string) => `${hourOf(iso)}:00`;
const deg = (n: number) => Math.round(n);

export function weatherPanel(f: Forecast): WeatherPanel {
  const c = f.current;
  const day = c.time.slice(0, 10);
  const h = f.hourly;
  // Index of the hour containing now; hourly starts at 00:00 today.
  const i0 = Math.max(0, h.time.findIndex((t) => t.slice(0, 13) === c.time.slice(0, 13)));
  const isDay = c.is_day === 1;

  const gustAt = (i: number) => h.wind_gusts_10m?.[i] ?? null;
  const nowGusts = c.wind_gusts_10m ?? gustAt(i0);

  // What's coming, one line: the rest of today (and tonight, after dark).
  const rest: number[] = [];
  for (let i = i0 + 1; i < h.time.length && h.time[i].startsWith(day); i++) rest.push(i);
  const wetAt = (i: number) => wet(h.weather_code[i], h.precipitation_probability[i]);
  const wetWord = (code: number) => (STORMY(code) ? 'thunder' : SNOWY(code) ? 'snow' : 'rain');
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
  let ahead: string;
  if (wet(c.weather_code, null)) {
    const word = cap(wetWord(c.weather_code));
    const dry = rest.find((i) => !wetAt(i));
    ahead = dry != null ? `${word} until ${hm(h.time[dry])}` : `${word} all ${hourOf(c.time) < 12 ? 'day' : 'evening'}`;
  } else {
    const rain = rest.find(wetAt);
    const gust = Math.max(nowGusts ?? 0, ...rest.map((i) => gustAt(i) ?? 0));
    if (rain != null) ahead = `${labelOf(c.weather_code, isDay)} now · ${wetWord(h.weather_code[rain])} from ${hm(h.time[rain])}`;
    else if (gust >= BREEZY_KMH) ahead = `Gusts up to ${deg(gust)} km/h`;
    else ahead = hourOf(c.time) < 17 ? 'Dry all day' : 'Dry tonight';
  }

  // Hourly strip: every 3 h from the next whole hour, five slots (may cross midnight).
  const hourly = [];
  for (let k = 0, i = i0 + 1; k < 5 && i < h.time.length; k++, i += 3) {
    hourly.push({ time: hm(h.time[i]), cond: condOf(h.weather_code[i], h.is_day[i] === 1, gustAt(i)), temp: deg(h.temperature_2m[i]) });
  }

  // Night view (22:00–06:00): now, and the day the family wakes into.
  const d = hourOf(c.time) < 12 ? 0 : 1;
  const when = d === 0 ? 'today' : 'tomorrow';
  const night = {
    cond: condOf(c.weather_code, false),
    text: `${deg(c.temperature_2m)}° ${labelOf(c.weather_code, false).toLowerCase()} · ${when} ${labelOf(f.daily.weather_code[d], true).toLowerCase()}, high ${deg(f.daily.temperature_2m_max[d])}°`,
  };

  return {
    now: {
      cond: condOf(c.weather_code, isDay, nowGusts),
      temp: deg(c.temperature_2m),
      label: condOf(c.weather_code, isDay, nowGusts) === 'wind' ? 'Breezy' : labelOf(c.weather_code, isDay),
    },
    high: deg(f.daily.temperature_2m_max[0]),
    low: deg(f.daily.temperature_2m_min[0]),
    ahead,
    hourly,
    night,
  };
}

// Tried in order. Geo-DNS pins the VM to one Open-Meteo node, and on 2026-11-15
// that node (51.81.167.44) was down for everyone while the European one was
// fine; the historical-forecast host serves the same forecast, same schema.
const HOSTS = ['api.open-meteo.com', 'historical-forecast-api.open-meteo.com'];

export function forecastUrl(lat: number, lon: number, host = HOSTS[0]): string {
  const q = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,weather_code,is_day,wind_gusts_10m',
    hourly: 'temperature_2m,weather_code,precipitation_probability,is_day,wind_gusts_10m',
    daily: 'temperature_2m_max,temperature_2m_min,weather_code',
    timezone: 'Asia/Tokyo',
    forecast_days: '2',
  });
  return `https://${host}/v1/forecast?${q}`;
}

/**
 * Poll every `everyMs` (Open-Meteo refreshes `current` every 15 min) and hand
 * each new panel to `publish`. A failed fetch keeps the last panel up rather
 * than clearing it: an absent panel would fall back to dummy weather on the board.
 */
export function startWeather(lat: number, lon: number, everyMs: number, publish: (p: WeatherPanel) => void): void {
  let last = '';
  const tick = async () => {
    for (const host of HOSTS) {
      try {
        const r = await fetch(forecastUrl(lat, lon, host), { signal: AbortSignal.timeout(10_000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const panel = weatherPanel((await r.json()) as Forecast);
        const key = JSON.stringify(panel);
        if (key !== last) { last = key; publish(panel); }
        return;
      } catch (e) {
        const cause = e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e);
        console.error(`[weather] ${host} failed: ${cause}`);
      }
    }
  };
  void tick();
  setInterval(tick, everyMs).unref();
}
