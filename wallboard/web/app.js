// The wallboard. Three views (ambient / active / night) on one fixed 1920×1080
// stage, one SSE stream carrying the server's state, and dummy content filling
// whatever Eva hasn't pushed yet.
//
// Test hooks (query string, combinable):
//   ?mode=ambient|active|night   pin the resting view instead of following the clock
//   ?time=21:45                  pretend it's this time (the clock still ticks)
//   ?debug=1                     show Silk's viewport size — DESIGN.md asks to confirm it
//   ?eva=new                     replay Eva's new-message arrival a moment after load
//                                (with the dummy message if nothing was pushed)
//   ?sound=off                   no countdown chimes; ?sound=announce|alarm plays that
//                                cue on every tap (to hear it on the Echo's speaker)

import { icon, glyph, star, weatherIcon } from './icons.js';
import { BITS, BALLOONS, FLAKES, RAIN, UP, SNOW, FLAKE_SVG, TILE_ICONS } from './celebrate.js';
import { ORDER, person } from './household.js';
import { dummy } from './dummy.js';
import { EvaSpot, evaMessage, evaSig } from './eva.js';
import { comingUp, shownAt } from './comingup.js';
import { rollBath } from './bath.js';
import { ANNOUNCE, ALARM, render as renderCue, wav, cueFor } from './chime.js';

const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);

const IDLE_MS = 60_000;          // active → resting view after a minute untouched
const TOAST_MS = 8_000;          // undo window
const LEAVE_WINDOW_MIN = 45;     // the leave-by card only exists inside this window
const BED_WINDOW_MIN = 30;       // …and the bedtime one inside this (DESIGN.md "Routine")
const PHOTO_MS = 4 * 60_000;     // memory crossfade, 3–5 min in the design
const NIGHT_MOVE_MS = 10 * 60_000;

// ---- time ------------------------------------------------------------------

const offset = (() => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(q.get('time') ?? '');
  if (!m) return 0;
  const want = new Date();
  want.setHours(+m[1], +m[2], 0, 0);
  return want.getTime() - Date.now();
})();
const now = () => new Date(Date.now() + offset);
const minutesOfDay = (d) => d.getHours() * 60 + d.getMinutes();
/** The board's local date, "2026-11-18". */
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** "7:55" / "18:30" → minutes since midnight. */
function parseHM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? ''));
  return m ? +m[1] * 60 + +m[2] : null;
}
const fmtHM = (d) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Night view 22:00–06:00; the day theme starts as night ends.
const NIGHT_START = 22 * 60;
const NIGHT_END = 6 * 60;
function isNight(d) {
  const m = minutesOfDay(d);
  return m >= NIGHT_START || m < NIGHT_END;
}

// Themes by time of day (DESIGN.md): Morning paper 06:00–21:00, Haven Night
// (dark) until 22:00, then the night view. ?theme=day|evening pins it.
function themeFor(d) {
  const pinned = q.get('theme');
  if (pinned === 'day' || pinned === 'evening') return pinned;
  const m = minutesOfDay(d);
  return m >= NIGHT_END && m < 21 * 60 ? 'day' : 'evening';
}

let themeTimer = null;
function applyTheme(animate) {
  const st = $('stage');
  const next = themeFor(now());
  if (st.dataset.theme === next) return;
  if (animate) {
    // Crossfade colours only while switching; see .stage.theming in styles.css.
    clearTimeout(themeTimer);
    st.classList.add('theming');
    themeTimer = setTimeout(() => st.classList.remove('theming'), 1600);
  }
  st.dataset.theme = next;
}

// ---- state -------------------------------------------------------------------

let server = null;               // BoardState from the server
const pending = new Map();       // chore id → done, sent but not yet confirmed
const DUMMY = dummy();

// Bath order lives only in this browser for now (no server model yet), and
// rolls forward a night at a time (web/bath.js, ASC-34). Persisted so a reload
// doesn't reset it. Pay is the server's.
let local = loadLocal();
saveLocal();   // pin the rolled bath state's date, or a reload tomorrow would adopt it as new
function loadLocal() {
  try {
    const s = JSON.parse(localStorage.getItem('wallboard.local') ?? 'null');
    if (s && s.bath) return { ...s, bath: rollBath(s.bath, dayKey(now())) };
  } catch {}
  return {
    bath: { date: dayKey(now()), tonight: 'sarina', history: [] },
  };
}
function saveLocal() {
  try { localStorage.setItem('wallboard.local', JSON.stringify(local)); } catch {}
}

/** A panel Eva pushed wins; otherwise the dummy. Pushed-but-empty stays empty. */
function content(key) {
  const p = server?.panels?.[key];
  return p ? p.data : DUMMY[key];
}

/**
 * Countdowns, nearest first: what Eva pushed plus the server's defaults (the
 * nearest birthday, major holiday and school event, server/occasions.ts),
 * merged in web/comingup.js. The dummy ones only when the server has neither.
 */
function countdowns() {
  const pushed = server?.panels?.countdowns ? server.panels.countdowns.data ?? [] : null;
  const defaults = server?.panels?.occasions ? server.panels.occasions.data ?? [] : null;
  const d = now();
  const today = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return comingUp(pushed ?? (defaults ? null : DUMMY.countdowns), defaults, today);
}

// The calm tile rotates through them (ASC-25): one every ROTATE_MS, crossfading
// in place. It holds still mid-celebration and while the calm strip is hidden,
// and a re-render in between keeps showing the same one.
const ROTATE_MS = 20_000;
const FADE_MS = 400;          // matches .sd-count > * in styles.css
let rotStep = 0;
let rotFresh = false;         // the next strip render fades the tile's content in
const shownCountdown = () => shownAt(countdowns(), rotStep);

function rotate() {
  if (Date.now() < partyUntil || view !== 'ambient' || countdowns().length < 2) return;
  const tile = document.querySelector('#amb-strip .sd-count');
  const swap = () => {
    if (Date.now() < partyUntil) return;           // tapped mid-fade: the party has the tile now
    rotStep += 1;
    rotFresh = !reduceMotion();
    $('amb-strip').innerHTML = strip().join('');
  };
  if (!tile || reduceMotion()) return swap();
  tile.classList.add('is-out');
  setTimeout(swap, FADE_MS);
}

function chores() {
  return (server?.chores ?? []).map((c) => (pending.has(c.id) ? { ...c, done: pending.get(c.id) } : c));
}

/** People with chores, household order first, then anyone the board doesn't know. */
function choreGroups() {
  const list = chores();
  const ids = [...new Set(list.map((c) => c.who ?? 'anyone'))];
  ids.sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  return ids.map((id) => {
    const items = list.filter((c) => (c.who ?? 'anyone') === id);
    const n = items.filter((c) => c.done).length;
    return { id, p: person(id), items, n, all: items.length > 0 && n === items.length };
  });
}

// ---- views -------------------------------------------------------------------

let view = null;
let dimmed = false;
let idleTimer = null;

const resting = () => {
  const m = q.get('mode');
  if (m === 'ambient' || m === 'night' || m === 'active') return m;
  return isNight(now()) ? 'night' : 'ambient';
};

function show(next, { dim = false } = {}) {
  view = next;
  dimmed = dim;
  for (const v of ['ambient', 'active', 'night']) $(v).classList.toggle('on', v === next);
  $('active').classList.toggle('dimmed', next === 'active' && dim);
  if (next !== 'active') hideToast();
  renderAll();
  armIdle();
}

function armIdle() {
  clearTimeout(idleTimer);
  if (view === 'active' && resting() !== 'active') idleTimer = setTimeout(() => show(resting()), IDLE_MS);
}

// ---- render: shared bits -------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function avatar(id, size, font) {
  const p = person(id);
  return `<span class="avatar" style="width:${size}px;height:${size}px;background:${p.bg};color:${p.fg};font-size:${font}px">${esc(p.ini)}</span>`;
}

const names = (ids) => (ids ?? []).map((id) => person(id).name).join(' & ');

/** Minutes until the leave-by time, or null when outside its window. */
function leaveMinutes() {
  const lb = content('leave-by');
  const at = parseHM(lb?.at);
  if (at == null) return null;
  const mins = at - minutesOfDay(now());
  return mins > 0 && mins <= LEAVE_WINDOW_MIN ? mins : null;
}

/**
 * The one countdown card, if a window is open: the school run (45 min before)
 * or bedtime (30 min before). They never overlap — one is morning, one evening.
 */
function countdown() {
  const m = leaveMinutes();
  if (m != null) return { item: content('leave-by'), mins: m, icon: 'leave', verb: 'out the door by' };
  const bt = content('bedtime');
  const at = parseHM(bt?.at);
  if (at == null) return null;
  const mins = at - minutesOfDay(now());
  return mins > 0 && mins <= BED_WINDOW_MIN ? { item: bt, mins, icon: 'moon', verb: 'in bed by' } : null;
}

function bathFirst() {
  return person(local.bath.tonight).name;
}

/** Sort key: all-day events (from the calendar) before anything timed. */
const startOf = (e) => (e.allDay ? -1 : parseHM(e.start ?? e.at));
const timeLabel = (e) => (e.allDay ? 'All day' : fmtMin(parseHM(e.start ?? e.at)));
const fmtMin = (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;

function schedule() {
  const items = (content('schedule') ?? []).map((e) => ({ ...e, sub: String(e.sub ?? '').replace('{bath}', bathFirst()) }));
  const lb = content('leave-by');
  if (lb?.at) items.push({ at: lb.at, title: lb.label, who: lb.who, leave: true });
  return items.filter((e) => startOf(e) != null).sort((a, b) => startOf(a) - startOf(b));
}

function owedYen(id) { return server?.balances?.[id]?.owed ?? 0; }
const yen = (n) => `¥${n.toLocaleString('en-US')}`;
/** "Mon 14 Nov", the Tokyo date of a timestamp, built by hand so locale order can't change it. */
function paidDate(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', weekday: 'short', day: 'numeric', month: 'short',
  }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${p.month}`;
}
const days = (n) => `${n} ${n === 1 ? 'day' : 'days'}`;

// ---- render: ambient -----------------------------------------------------------

function renderAmbient() {
  fitRightColumn();

  // Mid-celebration, leave the strip alone: a re-render would restart the burst.
  if (Date.now() >= partyUntil) $('amb-strip').innerHTML = strip().join('');
}

// ---- calm right column (CLAUDE.md "Calm view: right column changes through the day")
//
// Who has what today, so the family can prepare: a "Next up" card when
// something starts within the hour, then a per-person "Today" card; after
// dinner (everything done, or 18:30) "Tomorrow", with bath order riding in the
// evening's Next-up card. Never more than two cards. Reference:
// design/DayFlow.dc.html. Everything here sits on a card, never on the photo.

const SOON_MIN = 60;                    // "Next up" appears this long before an event
const EVENING_SWITCH = 18 * 60 + 30;    // Today → Tonight + Tomorrow, at the latest
const PILL_MAX = 3;                     // more than this per person: next 2 + "+N more"

/**
 * A schedule entry, normalised: start/end in minutes (end defaults to start +
 * 60 for the done state), arrays never missing. Accepts the older `at` too.
 */
function normEvent(e, i) {
  const start = e?.allDay ? null : parseHM(e?.start ?? e?.at);
  const end = parseHM(e?.end) ?? (start == null ? null : start + 60);
  return {
    ...e, id: e?.id ?? `e${i}`, start, end,
    who: Array.isArray(e?.who) ? e.who : [],
    bring: Array.isArray(e?.bring) ? e.bring : [],
    icon: e?.icon ?? 'calendar',
  };
}

/** `schedule` / `tomorrow` as events, or null when it isn't a list (absent, or the old shape). */
function events(key) {
  const list = content(key);
  return Array.isArray(list) ? list.map(normEvent).filter((e) => e.allDay || e.start != null) : null;
}

// Bedtime is routine, not "who has what": it gets its own countdown and a
// place in Tonight, but no pill on the girls' rows.
const isBedtime = (e) => e.id === 'bedtime' || e.title === 'Bedtime';
const todayEvents = () => (events('schedule') ?? []).filter((e) => !isBedtime(e));

/** Rain in the forecast between now and `endMin`. */
function rainBefore(endMin) {
  const t = minutesOfDay(now());
  return (content('weather')?.hourly ?? []).some((h) => {
    const m = parseHM(h.time);
    return m != null && m > t - 60 && m < endMin && (h.cond === 'rain' || h.cond === 'storm');
  });
}

const sameLabel = (a, b) => String(a.label).toLowerCase() === String(b.label).toLowerCase();
function unionBring(lists) {
  const out = [];
  for (const b of lists.flat()) if (b?.label && !out.some((x) => sameLabel(x, b))) out.push(b);
  return out;
}

/**
 * The soonest thing starting within its window, or null: an event within the
 * hour, the school run inside its 45 min, bedtime inside its 30. Events that
 * start at the same minute share the card (Swim + Nozomi's pickup), so its
 * avatars and bring list are the union. Always counted down to a real start
 * time, never relative to page load.
 */
function nextUp() {
  const t = minutesOfDay(now());
  const within = (m, w) => m != null && m - t > 0 && m - t <= w;
  const c = [];
  const lb = content('leave-by');
  // The girls are out until evening, so any rain later today means an umbrella now.
  if (within(parseHM(lb?.at), LEAVE_WINDOW_MIN)) {
    c.push({ id: 'leave', start: parseHM(lb.at), end: 24 * 60, who: lb.who ?? [], icon: 'bag', label: lb.label ?? 'Leave for school', title: `by ${lb.at}`, bring: lb.bring ?? [] });
  }
  const bt = content('bedtime');
  if (within(parseHM(bt?.at), BED_WINDOW_MIN)) {
    c.push({ id: 'bedtime', start: parseHM(bt.at), end: parseHM(bt.at), who: bt.who ?? [], icon: 'moon', label: bt.label ?? 'Bedtime', title: `by ${bt.at}`, bring: [] });
  }
  for (const e of todayEvents()) if (!e.allDay && within(e.start, SOON_MIN)) c.push({ ...e, label: 'Next up' });
  if (!c.length) return null;
  c.sort((a, b) => a.start - b.start);
  const group = c.filter((e) => e.start === c[0].start);
  const who = ORDER.filter((id) => group.some((e) => e.who.includes(id)));
  for (const e of group) for (const id of e.who) if (!who.includes(id)) who.push(id);
  const bring = unionBring(group.map((e) => e.bring));
  if (rainBefore(Math.max(...group.map((e) => e.end))) && !bring.some((b) => b.icon === 'umbrella')) bring.push({ icon: 'umbrella', label: 'Umbrella' });
  return { ...group[0], who, bring, mins: c[0].start - t, ids: new Set(group.map((e) => e.id)) };
}

/** Today is over: every timed item done, or 18:30, whichever is first. */
function dayOver() {
  const t = minutesOfDay(now());
  if (t >= EVENING_SWITCH) return true;
  const timed = todayEvents().filter((e) => !e.allDay);
  return timed.length > 0 && timed.every((e) => e.end <= t);
}

const rcHead = (ic, label, extra = '') =>
  `<div class="rc-eyebrow">${icon(ic, 30, ic === 'clock' || ic === 'moon' ? 1.75 : 1.9)}<span>${esc(label)}</span>${extra}</div>`;

/**
 * Weather, the right column's first card (CLAUDE.md "Weather: top-right card"):
 * condition in a tinted circle, the temperature now, today's high ↑ and low ↓,
 * and one line of what's coming. Never trimmed by the space budget.
 */
function weatherCard() {
  const w = content('weather');
  if (!w?.now) return '';
  const [ic, fg, bg] = weatherIcon(w.now.cond);
  const arrow = (d) => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const hl = [
    w.high != null ? `<span class="rc-wx-up">${arrow('M12 19V5M6 11l6-6 6 6')}<b>${esc(w.high)}°</b></span>` : '',
    w.low != null ? `<span class="rc-wx-down">${arrow('M12 5v14M6 13l6 6 6-6')}<b>${esc(w.low)}°</b></span>` : '',
  ].join('');
  // `summary` is the panel's older one-liner ("High 19° · rain from 18:00").
  const ahead = w.ahead ?? w.summary ?? '';
  const said = [w.now.label, `${w.now.temp}°`, w.high != null && `high ${w.high}°`, w.low != null && `low ${w.low}°`].filter(Boolean).join(', ');
  return `<div class="rc-wx" role="group" aria-label="${esc(`${said}. ${ahead}`)}">
    <span class="rc-wx-disc" style="background:${bg};color:${fg}">${icon(ic, 64, 1.9)}</span>
    <span class="rc-wx-temp">${esc(w.now.temp)}°</span>
    <div class="rc-wx-text">${hl ? `<div class="rc-wx-hl">${hl}</div>` : ''}<span class="rc-wx-ahead">${esc(ahead)}</span></div></div>`;
}

const bringPills = (list) => list.map((b) => `<span class="rc-bp">${icon(b.icon ?? 'bag', 26, 1.9)}${esc(b.label)}</span>`).join('');

function pill(e, state) {
  const time = e.allDay ? '' : `<span class="t">${esc(fmtMin(e.start))}</span>`;
  const tick = state === 'done' ? icon('check', 22, 3) : '';
  const said = { done: 'done', next: 'next', up: 'later' }[state];
  return `<span class="rc-pill ${state}" role="img" aria-label="${esc(`${e.allDay ? 'All day' : fmtMin(e.start)} ${e.title}: ${said}`)}">${icon(e.icon, 28, 1.9)}${time}<span class="w">${esc(e.title)}</span>${tick}</span>`;
}

/**
 * One row's pills. `t` is null for a day that hasn't started (tomorrow). More
 * than `cap` items: the next two plus a "+N more" pill.
 */
function pills(items, t, nextIds, cap) {
  const sorted = [...items].sort((a, b) => (a.allDay ? -1 : a.start) - (b.allDay ? -1 : b.start));
  const done = (e) => t != null && !e.allDay && e.end <= t;
  const isNext = (e) => [...e.ids].some((id) => nextIds.has(id));
  // Their next item within the hour lights up even when the card shows something else.
  const soon = t == null ? null : sorted.find((e) => !e.allDay && e.start > t && e.start - t <= SOON_MIN);
  let list = sorted.map((e) => ({ e, s: done(e) ? 'done' : isNext(e) || e === soon ? 'next' : 'up' }));
  let more = 0;
  if (list.length > cap) {
    const left = list.filter((x) => x.s !== 'done');
    const shown = (left.length ? left : list.slice(-2)).slice(0, 2);
    more = list.length - shown.length;
    list = shown;
  }
  return list.map((x) => pill(x.e, x.s)).join('') + (more ? morePill(more) : '');
}

const morePill = (n) => `<span class="rc-pill up more"><span class="w">+${n} more</span></span>`;

/**
 * The same thing (title + time) for several people is one event shared by all
 * of them — the girls' 7:55 School is one row, not two.
 */
function mergeShared(list) {
  const out = [];
  for (const e of list) {
    const twin = out.find((x) => x.title === e.title && x.start === e.start && !!x.allDay === !!e.allDay);
    if (twin) {
      twin.who = [...new Set([...twin.who, ...e.who])];
      twin.bring = unionBring([twin.bring, e.bring]);
      twin.ids.add(e.id);
    } else out.push({ ...e, ids: new Set([e.id]) });
  }
  return out;
}

/**
 * Rows of a list card: one per group of people sharing items, in household
 * order (a shared row before its first person's own), people with nothing left
 * out, anything for no one we know last.
 */
function rowsOf(list) {
  const rows = new Map();
  for (const e of mergeShared(list)) {
    const who = ORDER.filter((id) => e.who.includes(id));
    const key = who.join('+');
    if (!rows.has(key)) rows.set(key, { who, items: [] });
    rows.get(key).items.push(e);
  }
  const rank = (r) => (r.who.length ? ORDER.indexOf(r.who[0]) * 10 - r.who.length : 1e3);
  return [...rows.values()].sort((a, b) => rank(a) - rank(b));
}

/**
 * A list card's rows at compaction `level` (CLAUDE.md "Space budget"): 0 is
 * the full card; 1 caps every row at 2 pills; each level after drops one more
 * row from the bottom behind a "+N more" row. `last` says nothing is left to drop.
 */
function listRows(list, t, nextIds, level) {
  const rows = rowsOf(list);
  if (!rows.length) return { html: '<span class="rc-free">Nothing scheduled</span>', last: true };
  const cap = level === 0 ? PILL_MAX : 2;
  const drop = Math.min(Math.max(level - 1, 0), rows.length);
  const kept = rows.slice(0, rows.length - drop);
  const hidden = rows.slice(kept.length).reduce((n, r) => n + r.items.length, 0);
  const shared = rows.some((r) => r.who.length > 1);
  const face = (r) => {
    const avs = r.who.length
      ? r.who.map((id, i) => `<span class="rc-ov"${i ? ' style="margin-left:-14px"' : ''}>${avatar(id, 48, 20)}</span>`).join('')
      : `<span class="avatar rc-home" aria-label="Everyone">${icon('home', 30, 1.9)}</span>`;
    return shared ? `<span class="rc-slot">${avs}</span>` : avs;
  };
  const html = kept.map((r) => `<div class="rc-row">${face(r)}<div class="rc-pills">${pills(r.items, t, nextIds, cap)}</div></div>`).join('')
    + (hidden ? `<div class="rc-row"><div class="rc-pills">${morePill(hidden)}</div></div>` : '');
  return { html, last: drop === rows.length };
}

/** Who bathes first tonight: a row inside the evening's Next-up card (or atop Tomorrow). */
function bathRow() {
  const id = local.bath.tonight;
  return `<div class="rc-bathrow"><span class="rc-bath">${icon('bath', 28, 1.9)}</span><span class="rc-bt">Bath first</span>${avatar(id, 44, 16)}<span class="rc-bt">${esc(person(id).name)}</span></div>`;
}

/**
 * The calm right column at compaction `level`. At most two cards: Next up (if
 * any) and one list — Today, or Tomorrow after the switch. Returns the html and
 * whether this is the most compact it gets.
 */
function rightColumn(level = 0) {
  const t = minutesOfDay(now());
  const up = nextUp();
  const nextIds = up?.ids ?? new Set();
  const evening = dayOver();
  const out = [weatherCard()];
  if (up) {
    const avs = up.who.length ? `<span class="rc-avs">${up.who.map((id) => avatar(id, 44, 16)).join('')}</span>` : '';
    out.push(`<div class="rc-card rc-next">${rcHead(up.icon, up.label, avs)}
      <div class="rc-count"><span class="big">${up.mins}</span><span class="unit">min</span><span class="what">${esc(up.title)}</span></div>
      ${up.bring.length ? `<div class="rc-bring"><span class="rc-k">Bring</span>${bringPills(up.bring)}</div>` : ''}
      ${evening ? bathRow() : ''}</div>`);
  }
  if (!evening) {
    const rows = listRows(todayEvents(), t, nextIds, level);
    out.push(`<div class="rc-card">${rcHead('clock', 'Today')}${rows.html}</div>`);
    return { html: out.join(''), last: rows.last };
  }
  // After dinner: tomorrow, and what to pack for it tonight.
  const bath = up ? '' : bathRow();
  const tm = events('tomorrow');
  if (!tm) {
    if (bath) out.push(`<div class="rc-card">${rcHead('moon', 'Tonight')}${bath}</div>`);
    return { html: out.join(''), last: true };
  }
  const pack = unionBring(tm.map((e) => e.bring));
  const rows = listRows(tm, null, new Set(), level);
  out.push(`<div class="rc-card">${rcHead('clock', `Tomorrow · ${WEEKDAYS[(now().getDay() + 1) % 7]}`)}${bath}${rows.html}
    ${pack.length ? `<div class="rc-bring rc-pack"><span class="rc-k">Pack tonight</span>${bringPills(pack)}</div>` : ''}</div>`);
  return { html: out.join(''), last: rows.last };
}

/**
 * Render the right column, compacting until it fits above the strip. The
 * column clips (overflow: hidden) as a backstop, so it can never overlap.
 */
function fitRightColumn() {
  const el = $('amb-right');
  for (let level = 0; ; level++) {
    const { html, last } = rightColumn(level);
    el.innerHTML = html;
    if (last || el.scrollHeight <= el.clientHeight) return;
  }
}

// Calm strip, both themes (PaperV3HaloLandscape.dc.html by day, Main.dc.html in
// the evening): big signals readable from across the kitchen — one icon per
// chore, who bathes first, one countdown. Counts, chore names and pay live in
// the active view.
const DOT_ROOM = 345;   // px for the chore dots in a kid tile at 1920 wide

function strip() {
  const who = (id, badge = '') => {
    const p = person(id);
    return `<div class="sd-who"><span class="avatar sd-av" style="background:${p.bg};color:${p.fg}">${esc(p.ini)}${badge}</span><span class="sd-name">${esc(p.name)}</span></div>`;
  };
  const out = choreGroups().filter((g) => person(g.id).kid).map((g) => {
    const n = g.items.length;
    // Four fit at the design's 64 px; more shrink to share the room.
    const size = Math.min(64, Math.floor((DOT_ROOM - 12 * (n - 1)) / Math.max(n, 1)));
    const dots = g.items.map((c) => `<span class="sd-dot${c.done ? ' on' : ''}" role="img" aria-label="${esc(c.title)}: ${c.done ? 'done' : 'to do'}" style="width:${size}px;height:${size}px">${icon(c.icon, Math.round(size * 36 / 64), 2)}${
      c.done ? `<span class="sd-tick">${icon('check', 18, 3.5)}</span>` : ''}</span>`).join('');
    const badge = g.all ? `<span class="sd-star">${star(24)}</span>` : '';
    return `<div class="strip-card sd-kid">${who(g.id, badge)}<div class="sd-dots">${dots}</div></div>`;
  });
  out.push(`<div class="strip-card sd-bath" aria-label="Bath first tonight: ${esc(bathFirst())}">
    <span class="sd-disc sd-cool">${icon('bath', 56, 1.9)}</span>${who(local.bath.tonight, '<span class="sd-first">1st</span>')}</div>`);
  const cd = shownCountdown();
  if (cd) out.push(countTile(cd, Date.now() < partyUntil, rotFresh));
  rotFresh = false;
  return out;
}

// The countdown tile and its celebration (design/EventTiles.dc.html): tap it
// and the icon wiggles, a burst plays, the text swaps to the day and how many
// sleeps; back after 4 s. What it looks like and how it celebrates depends on
// the countdown's `kind` (CLAUDE.md "Countdown kinds", design/EventIcons.dc.html).

/** kind → [icon, colour, effect]. Unknown kinds are `holiday`; no kind at all is a visit. */
const KINDS = {
  holiday: ['star', 'warm', 'confetti'],
  visit: ['gift', 'warm', 'confetti'],
  birthday: ['cake', 'pink', 'balloons'],
  trip: ['plane', 'cool', 'confetti'],
  move: ['box', 'warm', 'confetti'],
  anniversary: ['heart', 'pink', 'hearts'],
  recital: ['music', 'violet', 'notes'],
  sports: ['medal', 'warm', 'confetti'],
  ceremony: ['cap', 'violet', 'confetti'],
  school: ['bag', 'teal', 'confetti'],
  'new-year': ['sunrise', 'warm', 'confetti'],
  setsubun: ['oni', 'warm', 'beans'],
  hinamatsuri: ['dolls', 'pink', 'petals'],
  hanami: ['sakura', 'pink', 'petals'],
  kodomo: ['carp', 'cool', 'confetti'],
  tanabata: ['tanabata', 'violet', 'stars'],
  obon: ['lantern', 'warm', 'lanterns'],
  tsukimi: ['tsukimi', 'violet', 'stars'],
  valentine: ['heart', 'pink', 'hearts'],
  easter: ['egg', 'violet', 'confetti'],
  'parents-day': ['flower', 'pink', 'hearts'],
  july4: ['firework', 'cool', 'confetti'],
  halloween: ['pumpkin', 'warm', 'halloween'],
  thanksgiving: ['pie', 'warm', 'leaves'],
  christmas: ['tree', 'green', 'snow'],
  summer: ['sun', 'warm', 'confetti'],
  autumn: ['leaf', 'warm', 'leaves'],
  winter: ['snow', 'cool', 'snow'],
  spring: ['sakura', 'pink', 'petals'],
};
const kindOf = (cd) => (!cd?.kind ? 'visit' : Object.hasOwn(KINDS, cd.kind) ? cd.kind : 'holiday');

/** Pink and violet are the girls' colours, so they follow the theme like their avatars. */
const TONES = {
  warm: { disc: 'var(--warm-soft)', fg: 'var(--warm)', ink: 'var(--warm)' },
  cool: { disc: 'var(--cool-soft)', fg: 'var(--cool)', ink: 'var(--cool)' },
  teal: { disc: 'var(--accent-soft)', fg: 'var(--accent)', ink: 'var(--accent)' },
  pink: { disc: 'var(--sa-bg)', fg: 'var(--sa-fg)', ink: 'var(--sa-ink)' },
  violet: { disc: 'var(--ma-bg)', fg: 'var(--ma-fg)', ink: 'var(--ma-ink)' },
  green: { disc: 'var(--green-soft)', fg: 'var(--green)', ink: 'var(--green)' },
};

// Three motions, many particles (CLAUDE.md: rain/burst, rise, fall). Rise and
// fall reuse the balloon and snow paths from EventTiles with another shape on
// them, trimmed to ≤ 40 elements per party (tile burst + sky). Colours are the
// board's own particle palette (celebrate.js).
const FILLED = (body) => `<svg width="100%" height="100%" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${body}</svg>`;
const SHAPES = {
  hearts: { colors: ['#f5b3c8', '#8c2a4f'], scale: 0.7, svg: FILLED(glyph('heart')) },
  notes: { colors: ['#c9b6f5', '#4a3480'], scale: 0.7,
    svg: `<svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyph('music')}</svg>` },
  lanterns: { colors: ['#f2c27a'], scale: 0.8, css: 'border-radius: 50%; box-shadow: inset -6px -8px 0 rgba(0,0,0,0.08)' },
  leaves: { colors: ['#934606', '#f2c27a'], scale: 0.9, svg: FILLED('<path d="M5 19C5 10 10 4 20 4c0 10-6 15-15 15z"/>') },
  petals: { colors: ['#f5b3c8', '#fbdde6'], scale: 0.8, aspect: 0.75, css: 'border-radius: 70% 0 70% 0' },
  stars: { colors: ['#c9b6f5', '#4a3480', '#f2c27a'], scale: 0.7, svg: FILLED(glyph('star')) },
  beans: { colors: ['#934606', '#5f5345'], scale: 0.45, css: 'border-radius: 50%' },
};
const RISE = new Set(['hearts', 'notes', 'lanterns']);
const FALL = new Set(['leaves', 'petals', 'stars', 'beans']);
const FALL_SKY = 26;                                  // + 14 at the tile = 40
const HALLOWEEN = ['#934606', '#f2c27a', '#4a3480', '#c9b6f5'];   // orange + purple confetti

/** A particle's path and timing without its look, so another shape can ride it. */
const motion = (st) => st.split(';').map((x) => x.trim())
  .filter((x) => x && !/^(background|border-radius|box-shadow|width|height)\s*:/.test(x)).join('; ');
const widthOf = (st) => Number(/(?:^|;)\s*width:\s*(\d+)px/.exec(st)?.[1] ?? 20);

function particle(cls, st, fx, i) {
  const sh = SHAPES[fx];
  const c = sh.colors[i % sh.colors.length];
  const w = Math.round(widthOf(st) * sh.scale);
  const h = Math.round(w * (sh.aspect ?? 1));
  const look = sh.svg ? `color: ${c}` : `background: ${c}; ${sh.css}`;
  return `<span class="${cls} wb-nostr" style="${motion(st)}; width: ${w}px; height: ${h}px; ${look}">${sh.svg ?? ''}</span>`;
}
const recolor = (st, i, pal) => st.replace(/background: #[0-9a-f]{6}/i, `background: ${pal[i % pal.length]}`);

/** The burst at the tile's icon. */
function burstAt(fx) {
  if (fx === 'confetti') return BITS.map((st) => `<span class="wb-bit" style="${st}"></span>`).join('');
  if (fx === 'halloween') return BITS.map((st, i) => `<span class="wb-bit" style="${recolor(st, i, HALLOWEEN)}"></span>`).join('');
  if (fx === 'balloons') return BALLOONS.map((st) => `<span class="wb-balloon" style="${st}"></span>`).join('');
  if (fx === 'snow') return FLAKES.map((st) => `<span class="wb-flake" style="${st}">${FLAKE_SVG}</span>`).join('');
  if (RISE.has(fx)) return BALLOONS.map((st, i) => particle('wb-balloon', st, fx, i)).join('');
  return FLAKES.map((st, i) => particle('wb-flake', st, fx, i)).join('');
}

/** The whole-screen part of the party (EventTiles' .wb-sky). */
function sky(fx) {
  if (fx === 'balloons') return UP.map((st) => `<span class="wb-up" style="${st}"></span>`).join('');
  if (fx === 'snow') return SNOW.map((st) => `<span class="wb-snow" style="${st}">${FLAKE_SVG}</span>`).join('');
  if (fx === 'halloween') return RAIN.map((st, i) => `<span class="wb-rain" style="${recolor(st, i, HALLOWEEN)}"></span>`).join('');
  if (RISE.has(fx)) return UP.map((st, i) => particle('wb-up', st, fx, i)).join('');
  if (FALL.has(fx)) return SNOW.slice(0, FALL_SKY).map((st, i) => particle('wb-snow', st, fx, i)).join('');
  return RAIN.map((st) => `<span class="wb-rain" style="${st}"></span>`).join('');
}

/** How long a party lasts: EventTiles' sky runs longer for things that rise or fall. */
const partyMs = (fx) => (fx === 'confetti' || fx === 'halloween' ? 4800 : 5600);
let partyUntil = 0;
let partyTimer = null;

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function countTile(cd, party, fresh = false) {
  const kind = kindOf(cd);
  const [ic, tone, fx] = KINDS[kind];
  // A birthday in the household takes the birthday person's colours.
  const p = kind === 'birthday' && cd.who ? person(cd.who) : null;
  const look = p ? { disc: p.bg, fg: p.fg, ink: `var(--${cd.who.slice(0, 2)}-ink, ${p.fg})` } : TONES[tone];
  const svg = TILE_ICONS[ic] ?? glyph(ic);           // gift and cake have a lid/flame that moves
  const burst = party ? burstAt(fx) : '';
  const n = Number(cd.days);
  const d = now();
  const when = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const date = `${SHORT_DAYS[when.getDay()]} ${when.getDate()}${when.getMonth() === d.getMonth() ? '' : ` ${SHORT_MONTHS[when.getMonth()]}`}`;
  const text = party
    ? `<span class="wb-party-text wb-fit"><span class="sd-head" style="color:${look.ink}">${esc(cd.headline ?? cd.label)}</span><span class="sd-date">${esc(date)}</span><span class="sd-sleeps">${n} ${n === 1 ? 'sleep' : 'sleeps'} to go</span></span>`
    : `<span class="wb-fit"><span class="sd-num" style="color:${look.ink}">${esc(cd.days)}</span><span class="sd-lbl">${n === 1 ? 'day' : 'days'}</span><span class="sd-what">${esc(cd.label)}</span></span>`;
  return `<div class="strip-card sd-count wb-event${party ? ' is-party' : fresh ? ' is-in' : ''}" data-action="celebrate" role="button" aria-label="${esc(cd.label)} in ${esc(days(n))}. Tap to celebrate.">
    <span class="sd-disc wb-gift" style="background:${look.disc};color:${look.fg}"><svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="overflow:visible">${svg}</svg>${burst}</span>${text}</div>`;
}

function celebrate() {
  const fx = KINDS[kindOf(shownCountdown())][2];
  const ms = partyMs(fx);
  clearTimeout(partyTimer);
  partyUntil = Date.now() + ms;
  // Fresh elements every time, so a second tap replays from the start.
  $('amb-strip').innerHTML = strip().join('');
  $('amb-sky').innerHTML = sky(fx);
  $('amb-sky').hidden = false;
  evaFace();                                             // she cheers along
  partyTimer = setTimeout(() => {
    partyUntil = 0;
    $('amb-sky').hidden = true;
    $('amb-sky').innerHTML = '';                         // particles removed when the party ends
    renderAmbient();
    evaFace();
  }, ms);
}

// Memories: two stacked layers, crossfaded, each drifting very slowly.
//
// Source, first that has anything: a `memories` panel Eva pushed, then the
// server's rotating set from the iCloud albums, then the dummy placeholders.
// Order is a shuffle bag: random, but nothing repeats until everything in the
// current set has been shown once.
//
// Layout per photo by width ÷ height (DESIGN.md): ≥ 1.2 full-bleed; anything
// else (portrait or square-ish) alone in the left half. Portraits are never
// paired: one photo at a time, always.
let serverPhotos = [];
let bag = [];
let photoFront = 'mem-a';

async function loadPhotos() {
  try {
    const r = await fetch('/api/photos');
    if (r.ok) serverPhotos = (await r.json()).photos.map((p) => ({ src: `/photos/${p.id}.jpg`, caption: p.caption, w: p.w, h: p.h }));
  } catch {}
}

function photoSource() {
  if (server?.panels?.memories) return server.panels.memories.data ?? [];
  return serverPhotos.length ? serverPhotos : DUMMY.memories;
}

/** Unknown size (e.g. a pushed panel without w/h) is treated as landscape. */
const ratio = (p) => (p.w && p.h ? p.w / p.h : 16 / 9);

function refillBag(list) {
  const valid = new Set(list.map((p) => p.src));
  bag = bag.filter((p) => valid.has(p.src));
  if (!bag.length) {
    bag = list.slice();
    for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
  }
}

/** The next slide: always exactly one photo. Mutates the bag. */
function nextSlide(list) {
  refillBag(list);
  const first = bag.pop();
  return { layout: ratio(first) >= 1.2 ? 'full' : 'single', photos: [first] };
}

/** A barely-there zoom and pan: ≤3.5% scale and ≤12 px drift over the slide's whole turn. */
function kenBurns(el) {
  const r = () => Math.random() * 2 - 1;
  el.classList.remove('kb');
  el.style.setProperty('--kb-from', String(1 + Math.random() * 0.01));
  el.style.setProperty('--kb-to', String(1.02 + Math.random() * 0.015));
  el.style.setProperty('--kb-x', `${Math.round(r() * 12)}px`);
  el.style.setProperty('--kb-y', `${Math.round(r() * 8)}px`);
  el.style.setProperty('--kb-dur', `${PHOTO_MS + 5000}ms`);
  void el.offsetWidth;
  el.classList.add('kb');
}

function loadImg(src, cls) {
  const img = new Image();
  img.className = cls;
  img.alt = '';
  img.src = src;
  return (img.decode ? img.decode() : new Promise((ok, bad) => { img.onload = ok; img.onerror = bad; })).then(() => img);
}

let slideSeq = 0;
async function nextPhoto() {
  const list = photoSource();
  if (!list.length) { $('amb-caption').innerHTML = ''; return; }
  const slide = nextSlide(list);
  const seq = ++slideSeq;
  let imgs;
  try {
    imgs = await Promise.all(slide.photos.map((p) => loadImg(p.src, slide.layout)));
  } catch {
    return;   // a photo rotated out server-side: keep the current one up
  }
  if (seq !== slideSeq) return;
  const back = photoFront === 'mem-a' ? 'mem-b' : 'mem-a';
  const layer = $(back);
  layer.replaceChildren(...imgs);
  kenBurns(layer);
  layer.classList.add('shown');
  $(photoFront).classList.remove('shown');
  photoFront = back;
  const cap = slide.photos[0].caption;
  $('amb-caption').innerHTML = cap ? `${icon('photo', 26)}<span>Memories · ${esc(cap)}</span>` : '';
}

// ---- render: active ------------------------------------------------------------

function renderActive() {
  const w = content('weather');
  const hours = [];
  if (w?.now) hours.push({ h: 'Now', cond: w.now.cond, temp: w.now.temp, now: true });
  for (const x of w?.hourly ?? []) hours.push({ h: x.time, cond: x.cond, temp: x.temp });
  $('act-hourly').innerHTML = hours.map((x) => {
    const [ic, col] = weatherIcon(x.cond);
    return `<div class="hour ${x.now ? 'now' : ''}"><span class="h">${esc(x.h)}</span><span style="display:flex;color:${col}">${icon(ic, 32)}</span><span class="deg">${esc(x.temp)}°</span></div>`;
  }).join('');

  // Schedule: past rows fade, the next thing (or the leave-by, inside its window) is highlighted.
  const t = minutesOfDay(now());
  const lm = leaveMinutes();
  let items = schedule();
  const nextIdx = lm != null ? items.findIndex((e) => e.leave) : items.findIndex((e) => !e.allDay && startOf(e) > t);
  // Leave-by only appears in the list while it's still ahead.
  items = items.map((e, i) => ({ ...e, i })).filter((e) => !e.leave || startOf(e) > t);
  // Too many rows: drop the earliest finished timed events; all-day rows stay pinned on top.
  for (let k; items.length > 7 && (k = items.findIndex((e) => !e.allDay && startOf(e) <= t)) >= 0;) items.splice(k, 1);
  $('act-schedule').innerHTML = `<div class="card-head"><span class="ico-muted">${icon('calendar', 32)}</span><span class="card-title">Today</span></div>${
    items.length ? items.map((e) => {
      const next = e.i === nextIdx;
      const past = !e.allDay && startOf(e) <= t;
      const until = startOf(e) - t;
      const chips = (e.who ?? []).map((id) => avatar(id, 32, 13)).join('');
      const sub = next && until <= 60 ? `<span class="sub soon">in ${until} min</span>` : e.sub ? `<span class="sub">${esc(e.sub)}</span>` : '';
      return `<div class="ev ${next ? 'next' : ''} ${past ? 'past' : ''}"><span class="t${e.allDay ? ' allday' : ''}">${esc(timeLabel(e))}</span>
        <div class="body"><span class="title">${esc(e.title)}</span>${chips || sub ? `<div class="meta">${chips}${sub}</div>` : ''}</div></div>`;
    }).join('') : '<div class="ev-empty">Nothing on today</div>'
  }`;

  renderChores();

  // Bath order (this browser's, rolled nightly by web/bath.js).
  const b = local.bath;
  const last = b.history[b.history.length - 1];
  const auto = last === 'mariko' ? 'sarina' : 'mariko';
  $('act-bath').innerHTML = `<div class="bath-row"><div class="bath-ico">${icon('drop', 32)}</div>
      <span class="bath-k">Bath first tonight</span>${avatar(b.tonight, 48, 18)}<span class="bath-v">${esc(bathFirst())}</span>
      <button type="button" class="pill-btn pill-neutral" style="margin-left:auto" data-action="swap">${icon('swap', 26, 2)}Swap</button></div>
    <div class="bath-hist"><span class="k">Went first</span>${b.history.map((id, i, a) =>
      `<span style="opacity:${i === a.length - 1 ? 1 : 0.55};display:flex">${avatar(id, 32, 12)}</span>`).join('')}
      ${last ? `<span class="note">Last night: ${esc(person(last).name)}${b.tonight === auto ? '' : ' · swapped tonight'}</span>` : ''}</div>`;

  // Right column: leave/pickup, dinner, countdowns. Eva's bubble sits above
  // these in its own mount (#act-bubble), so a re-render never restarts her.
  const side = [];
  const pickup = content('pickup');
  const due = countdown();
  if (due || pickup) {
    side.push(`<div class="card side-go ${due ? 'glow' : ''}">${due ? `
      <span class="eyebrow" style="color:var(--accent)">${esc(due.item.label)}</span>
      <div class="mins"><span class="big">${due.mins}</span><span class="unit">min</span><span class="by">by ${esc(due.item.at)}</span></div>
      ${pickup ? '<div class="rule"></div>' : ''}` : ''}
      ${pickup ? `<span class="eyebrow">Pickup</span><span class="v">${esc(pickup.text)}</span>` : ''}</div>`);
  }
  const dinner = content('dinner');
  if (dinner) {
    side.push(`<div class="card side-dinner"><span style="display:flex;color:var(--warm)">${icon('dinner', 36)}</span>
      <div style="display:flex;flex-direction:column"><span class="k">Tonight ${esc(dinner.at ?? '')}</span><span class="v">${esc(dinner.text)}</span></div></div>`);
  }
  const cds = countdowns();
  if (cds.length) {
    side.push(`<div class="card side-count"><span class="eyebrow">Countdowns</span>${cds.map((c) =>
      `<div class="count-row"><span class="l">${esc(c.label)}</span><span class="r"><span class="num">${esc(c.days)}</span> days</span></div>`).join('')}</div>`);
  }
  $('act-side').innerHTML = side.join('');
}

// Chores are updated in place rather than re-rendered, so a broadcast landing
// mid-animation doesn't restart the check's pop or the card's glow.
let fresh = null;          // chore id just marked done; glows while its toast is up
let choreSig = '';
function renderChores() {
  const groups = choreGroups();
  const sig = groups.map((g) => g.id + ':' + g.items.map((c) => c.id + '/' + c.title + '/' + c.icon).join(',')).join('|');
  const cols = $('kid-cols');
  if (sig !== choreSig) {
    choreSig = sig;
    cols.innerHTML = groups.length ? groups.map((g) => `<div class="kid" data-who="${esc(g.id)}">
        <div class="kid-head">${avatar(g.id, 64, 24)}<div class="who"><span class="name">${esc(g.p.name)}</span><span class="status"></span></div><span class="star-slot" style="margin-left:auto"></span></div>
        <div class="segs"></div>
        <div class="kid-grid">${g.items.map((c) => `<button type="button" class="chore" data-action="chore" data-id="${esc(c.id)}">
          <span class="chore-icon">${icon(c.icon ?? 'chores', 36)}</span><span class="chore-label">${esc(c.title)}</span>
          <span class="chore-check" aria-hidden="true">${icon('check', 22, 3)}</span></button>`).join('')}</div>
        ${person(g.id).kid ? '<div class="pay"></div>' : ''}</div>`).join('')
      : '<div class="kid-empty">No chores yet — Eva hasn\'t sent any.</div>';
  }
  let total = 0, done = 0;
  for (const g of groups) {
    total += g.items.length; done += g.n;
    const col = cols.querySelector(`.kid[data-who="${CSS.escape(g.id)}"]`);
    if (!col) continue;
    const st = col.querySelector('.status');
    st.textContent = g.all ? 'All done' : `${g.n} of ${g.items.length} done`;
    st.classList.toggle('all', g.all);
    const slot = col.querySelector('.star-slot');
    if (g.all && !slot.firstChild) slot.innerHTML = `<span class="kid-star">${star(26)}</span>`;
    if (!g.all) slot.innerHTML = '';
    col.querySelector('.segs').innerHTML = g.items.map((c) => `<span class="${c.done ? 'on' : ''}"></span>`).join('');
    for (const c of g.items) {
      const btn = col.querySelector(`.chore[data-id="${CSS.escape(c.id)}"]`);
      btn.classList.toggle('is-done', c.done);
      btn.classList.toggle('is-fresh', c.done && fresh === c.id);
      btn.setAttribute('aria-pressed', String(c.done));
    }
    const pay = col.querySelector('.pay');
    if (pay) pay.innerHTML = payRow(g);
  }
  $('act-total').textContent = total ? `${done} of ${total} done` : '';
}

function payRow(g) {
  const bal = server?.balances?.[g.id];
  const owe = bal?.owed ?? 0, last = bal?.lastPaidAt ?? null;
  const can = owe > 0;
  let color, a;
  if (can) { color = 'var(--warm)'; a = `${yen(owe)} to pay`; }
  // Paid more than earned (Eva recorded extra): show the credit, never "Paid up".
  else if (owe < 0) { color = 'var(--ink-muted)'; a = `${yen(-owe)} credit`; }
  else if (last != null) { color = 'var(--success)'; a = 'Paid up'; }
  else { color = 'var(--ink-muted)'; a = 'Nothing owed'; }
  const b = last != null ? `Last paid ${paidDate(last)}` : 'Not paid yet';
  return `<span style="display:flex;color:${color}">${icon('pay', 30)}</span>
    <div class="txt"><span class="a" style="color:${color}">${a}</span><span class="b">${b}</span></div>
    ${can ? `<button type="button" class="pill-btn pill-warm" data-action="pay" data-who="${esc(g.id)}">Mark paid</button>` : ''}`;
}

// ---- render: night -------------------------------------------------------------

function renderNight() {
  const w = content('weather')?.night;
  $('night-weather').innerHTML = w ? `<span style="display:flex">${icon(weatherIcon(w.cond)[0], 30)}</span><span>${esc(w.text)}</span>` : '';
  // Tomorrow's first commitment. `tomorrow` is a list of events now; the older
  // `{at, title}` shape still reads.
  const raw = content('tomorrow');
  const first = Array.isArray(raw)
    ? raw.map(normEvent).filter((e) => !e.allDay && e.start != null).sort((a, b) => a.start - b.start)[0]
    : null;
  const tm = first ? { at: fmtMin(first.start), title: `Tomorrow · ${first.title}` } : raw?.at ? raw : null;
  $('night-tomorrow').innerHTML = tm ? `<span class="num">${esc(tm.at)}</span><span>${esc(tm.title)}</span>` : '';
}

// Night burn-in: the block jumps somewhere new every 10 minutes.
function moveNight() {
  const el = $('night-block');
  el.style.opacity = '0';
  setTimeout(() => {
    el.style.left = `${120 + Math.round(Math.random() * (stageW - 1020))}px`;
    // Eva hangs under the block now, so keep the whole stack on screen.
    el.style.top = `${100 + Math.round(Math.random() * Math.max(0, 1080 - 160 - el.offsetHeight))}px`;
    el.style.opacity = '1';
  }, 1600);
}

function renderAll() {
  if (view === 'ambient') renderAmbient();
  else if (view === 'active') renderActive();
  else if (view === 'night') renderNight();
  syncEva();
  chimeCheck();
}

// ---- countdown chimes (ASC-32, web/chime.js) ---------------------------------
//
// A beep-boop when the Next-up card starts counting down, and a music-box alarm
// at five minutes out. Each plays once per event per day; what has played is
// kept in localStorage so a redeploy's reload doesn't replay it. Never at night.
// Silk only lets audio start after a tap, which the keep-alive's first tap
// already gives the page; a cue the browser refuses is still marked played, so
// it can't go off stale when someone finally touches the board.

const CUES = {};
function cueAudio(name) {
  CUES[name] ??= URL.createObjectURL(new Blob([wav(renderCue(name === 'alarm' ? ALARM : ANNOUNCE))], { type: 'audio/wav' }));
  return new Audio(CUES[name]);
}
function playCue(name) {
  try { cueAudio(name).play().catch(() => {}); } catch {}
}

function loadPlayed(day) {
  try {
    const s = JSON.parse(localStorage.getItem('wallboard.chimes') ?? 'null');
    if (s?.day === day && Array.isArray(s.played)) return new Set(s.played);
  } catch {}
  return new Set();
}
let chimes = { day: null, played: new Set() };

function chimeCheck() {
  if (q.get('sound') === 'off') return;
  const d = now();
  const day = dayKey(d);
  if (chimes.day !== day) chimes = { day, played: loadPlayed(day) };
  if (isNight(d) || !server) return;
  const up = nextUp();
  // Only real events ring: never one the dummy content is standing in for.
  const source = up?.id === 'leave' ? 'leave-by' : up?.id === 'bedtime' ? 'bedtime' : 'schedule';
  if (up && !server.panels?.[source]) return;
  const { cue, mark } = cueFor(up && { key: `${up.id}@${up.start}`, mins: up.mins }, chimes.played);
  if (!cue) return;
  mark.forEach((m) => chimes.played.add(m));
  try { localStorage.setItem('wallboard.chimes', JSON.stringify({ day, played: [...chimes.played] })); } catch {}
  playCue(cue);
}

// ---- Eva (CLAUDE.md "Eva bubble") ----------------------------------------------
//
// One message, shown in up to three places: peeking on the calm view, under the
// bubble in the active view, asleep (no bubble) at night. The spots own their
// DOM and change it only when the message or her face changes, so the board's
// frequent re-renders never cut a blink or a pop short.

const EVA = {
  ambient: new EvaSpot($('amb-eva'), $('amb-bubble'), { size: 170, peek: true }),
  active: new EvaSpot($('act-eva'), $('act-bubble'), { size: 104, peek: true }),
  night: new EvaSpot($('night-eva'), null, { size: 130, theme: 'dark' }),
};
const BLINK_MIN = 6_000, BLINK_RAND = 14_000;   // a blink every 6–20 s while awake
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let evaShown;              // signature of the message on screen; undefined until first paint
let evaMsg = null;
let evaArriving = false;   // inside the ~1.2 s excited reaction to a new message
let evaTimers = [];

/** The pushed `eva` panel, else the old `note` one. Absent means nothing to say. */
function evaCurrent() {
  const p = server?.panels?.eva ?? server?.panels?.note;
  if (p) return evaMessage(p.data);
  return q.get('eva') === 'new' ? evaMessage(DUMMY.eva) : null;
}

const evaExpr = (spot) => spot === EVA.night ? 'sleepy'
  : evaArriving || Date.now() < partyUntil ? 'excited'
  : evaMsg?.mood ?? 'happy';

function evaFace() {
  for (const spot of Object.values(EVA)) spot.setExpr(evaExpr(spot));
}

function syncEva() {
  const m = evaCurrent();
  const sig = evaSig(m);
  if (evaShown === undefined) {           // first paint: no fanfare
    // Wait for the server's first state, or every page load would "arrive".
    if (!server && q.get('eva') !== 'new') return evaFace();
    evaShown = sig;
    evaMsg = m;
    for (const spot of Object.values(EVA)) spot.setMessage(m);
  } else if (sig !== evaShown) evaArrive(m);
  evaFace();
}

/** A new message: old bubble fades → excited hop → new bubble pops → blink → mood. */
function evaArrive(m) {
  evaShown = evaSig(m);
  evaMsg = m;
  for (const t of evaTimers) clearTimeout(t);
  const spot = EVA[view];
  // Only the view on screen performs; the others just take the new text.
  for (const s of Object.values(EVA)) if (s !== spot) s.setMessage(m);
  if (!spot?.bubble || !m) { spot?.setMessage(m); evaArriving = false; return evaFace(); }
  const still = reduceMotion();
  evaArriving = true;
  evaFace();
  spot.fadeOut();
  if (!still) spot.hop();
  evaTimers = [
    setTimeout(() => spot.setMessage(m, { pop: !still }), still ? 0 : 150),
    setTimeout(() => { if (!still) spot.blink(); }, 1100),
    setTimeout(() => { evaArriving = false; evaFace(); }, 1200),
  ];
}

function evaBlinkLoop() {
  setTimeout(() => {
    if (!reduceMotion() && !evaArriving && document.visibilityState === 'visible') EVA[view]?.blink(Math.random() < 0.2);
    evaBlinkLoop();
  }, BLINK_MIN + Math.random() * BLINK_RAND);
}

/** ?eva=new and wb.evaNew(): play the arrival again with whatever is showing. */
function evaReplay() {
  evaShown = '\u0000';
  syncEva();
}

// ---- clock -------------------------------------------------------------------

let lastMinute = -1;
function tick() {
  const d = now();
  const set = (k, v) => document.querySelectorAll(`[data-clock="${k}"]`).forEach((el) => { if (el.textContent !== v) el.textContent = v; });
  set('time', fmtHM(d));
  set('date', `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`);
  set('weekday', WEEKDAYS[d.getDay()]);
  set('daymonth', `${d.getDate()} ${MONTHS[d.getMonth()]}`);
  const m = minutesOfDay(d);
  if (m !== lastMinute) {
    lastMinute = m;
    rollBathToday();
    applyTheme(true);
    // Day/night handover happens on its own, but never yanks the active view from under a finger.
    if (view !== 'active' && view !== resting()) show(resting());
    else renderAll();
  }
}

// ---- toast + undo ------------------------------------------------------------

let toastTimer = null;
let undoFn = null;
function showToast({ ok, title, sub, undo }) {
  const t = $('toast');
  clearTimeout(toastTimer);
  undoFn = undo;
  t.classList.toggle('ok', ok);
  $('toast-chip').innerHTML = icon('check', 30, 3);
  $('toast-title').textContent = title;
  $('toast-sub').textContent = sub;
  const btn = t.querySelector('.toast-undo');
  btn.innerHTML = `${icon('undo', 28, 2)}Undo`;
  btn.hidden = !undo;
  // Restart the rise and drain animations for back-to-back taps.
  t.hidden = true; void t.offsetWidth; t.hidden = false;
  const bar = $('toast-timer');
  bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = '';
  toastTimer = setTimeout(hideToast, TOAST_MS);
}
function hideToast() {
  clearTimeout(toastTimer);
  $('toast').hidden = true;
  undoFn = null;
  if (fresh) { fresh = null; if (view === 'active') renderChores(); }
}

// ---- actions -----------------------------------------------------------------

async function setChore(id, done) {
  pending.set(id, done);
  renderChores();
  try {
    const r = await fetch(`/api/chores/${encodeURIComponent(id)}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ done }),
    });
    if (!r.ok) throw new Error(String(r.status));
    if (server?.chores.find((c) => c.id === id)?.done === done) pending.delete(id);
  } catch {
    pending.delete(id);
    if (fresh === id) fresh = null;
    renderChores();
    showToast({ ok: false, title: 'Couldn’t save that', sub: 'Check the connection and tap again', undo: null });
  }
}

function tapChore(id) {
  const c = chores().find((x) => x.id === id);
  if (!c) return;
  const next = !c.done;
  fresh = next ? id : null;
  setChore(id, next);
  const g = choreGroups().find((x) => x.items.some((i) => i.id === id));
  showToast({
    ok: next,
    title: `${c.title} — ${next ? 'done' : 'back to to-do'}`,
    sub: `${g.p.name} · ${g.all ? 'all done for today' : `${g.n} of ${g.items.length}`}`,
    undo: () => { fresh = null; setChore(id, !next); },
  });
}

function snapshot() { return JSON.parse(JSON.stringify(local)); }
function changeLocal(mutate, toast) {
  const prev = snapshot();
  mutate();
  saveLocal();
  renderAll();
  showToast({ ...toast, undo: () => { local = prev; saveLocal(); renderAll(); } });
}

// One Mark paid in flight per person: a second tap while the first is pending
// does nothing. The server also refuses (409) any amount that isn't what is owed.
const paying = new Set();
async function pay(who) {
  const amount = owedYen(who);
  if (amount <= 0 || paying.has(who)) return;
  paying.add(who);
  try {
    const r = await fetch(`/api/pay/${encodeURIComponent(who)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount }),
    });
    if (r.status === 409) {
      showToast({ ok: false, title: 'Balance changed', sub: 'Nothing was recorded · check the new amount', undo: null });
      return;
    }
    if (!r.ok) throw new Error(String(r.status));
    const { id } = await r.json();
    showToast({
      ok: true, title: `Paid ${person(who).name} ${yen(amount)}`, sub: 'Eva will note it',
      undo: () => cancelPayment(id),
    });
  } catch {
    showToast({ ok: false, title: 'Couldn’t save that', sub: 'Check the connection and tap again', undo: null });
  } finally {
    paying.delete(who);
  }
}

async function cancelPayment(id) {
  try {
    const r = await fetch(`/api/cancel/${encodeURIComponent(id)}`, { method: 'POST' });
    if (!r.ok) throw new Error(String(r.status));
  } catch {
    // No "tap again": the undo button is gone with the toast, so there is nothing to tap.
    showToast({ ok: false, title: 'Couldn’t undo the payment', sub: 'The payment still stands · check the connection', undo: null });
  }
}

/** A new day: last night's first goes on the history and the other girl is up. */
function rollBathToday() {
  const b = rollBath(local.bath, dayKey(now()));
  if (b.date === local.bath.date && b.tonight === local.bath.tonight) return;
  local.bath = b;
  saveLocal();
}

function swapBath() {
  const next = local.bath.tonight === 'mariko' ? 'sarina' : 'mariko';
  changeLocal(() => { local.bath.tonight = next; },
    { ok: true, title: `${person(next).name} goes first tonight`, sub: 'Swapped by hand · next turn adjusts' });
}

$('stage').addEventListener('pointerdown', () => { if (view === 'active') armIdle(); });
$('stage').addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  switch (el.dataset.action) {
    case 'wake': return show('active', { dim: view === 'night' });
    case 'celebrate': return celebrate();
    case 'home': return show(resting());
    case 'chore': return tapChore(el.dataset.id);
    case 'pay': return pay(el.dataset.who);
    case 'swap': return swapBath();
    case 'undo': { const u = undoFn; hideToast(); if (u) u(); return; }
  }
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

// ---- live connection ---------------------------------------------------------

let build = null;
function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('hello', (e) => {
    const b = JSON.parse(e.data).build;
    if (build && b !== build) location.reload();   // redeployed: pick up the new page
    build = b;
    $('offline').hidden = true;
  });
  es.addEventListener('state', (e) => {
    server = JSON.parse(e.data);
    for (const [id, done] of pending) if (server.chores.find((c) => c.id === id)?.done === done) pending.delete(id);
    renderAll();
  });
  es.onerror = () => { $('offline').hidden = false; };
}

// ---- fit the stage to the screen -------------------------------------------------

// The design is 1920×1080, but Silk's toolbar eats height, so the real viewport
// is wider than 16:9. Rather than letterbox, keep the design's short side and
// stretch the long one to the screen's shape: every layout is flex, so the
// extra width lands in the gaps and columns instead of as black bars.
let stageW = 1920;
function fit() {
  const aspect = innerWidth / innerHeight;
  const w = aspect >= 16 / 9 ? Math.round(1080 * aspect) : 1920;
  const h = aspect >= 16 / 9 ? 1080 : Math.round(1920 / aspect);
  const s = innerWidth / w;
  stageW = w;
  const st = $('stage');
  st.style.width = `${w}px`;
  st.style.height = `${h}px`;
  st.style.transform = `scale(${s})`;
  if (q.get('debug')) {
    $('debug').hidden = false;
    $('debug').textContent = `viewport ${innerWidth}×${innerHeight} @${devicePixelRatio}x · stage ${w}×${h} · scale ${s.toFixed(3)} · ${navigator.userAgent.match(/Silk\/[\d.]+/)?.[0] ?? ''}`
      + ` · audio ${typeof keepAlive === 'undefined' ? '-' : keepAlive.paused ? 'paused' : 'playing'} · wakelock ${'wakeLock' in navigator ? (typeof wakeLock !== 'undefined' && wakeLock ? 'held' : 'free') : 'n/a'}`;
  }
}

// Silk's toolbar costs ~7% of the screen. Ask for fullscreen on the first tap
// (browsers only allow it inside a gesture); a reload drops it, and the next tap
// asks again. Silently does nothing where it isn't supported.
function goFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || document.webkitFullscreenElement) return;
  const req = el.requestFullscreen ?? el.webkitRequestFullscreen;
  if (req) Promise.resolve(req.call(el)).catch(() => {});
}

// ---- keep alive ----------------------------------------------------------------
//
// The Echo Show returns to the Alexa home after a while; Amazon says Silk isn't
// meant for long-term viewing. The community workaround (keep-silk-open, used for
// Home Assistant dashboards on the Show 15) is a page that keeps playing audio, so
// Silk counts it as in use. Ours is a looped clip of true digital silence
// (all-zero samples, not just muted, since a muted element may not count as
// playing). Audio may only start inside a gesture, so it rides the same first tap as
// fullscreen; a minute timer restarts it if Alexa paused it. Screen Wake Lock is
// tried too, where Silk has it.

function silentWav(seconds = 2, rate = 8000) {
  const n = seconds * rate;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);   // samples stay zero: real silence
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

const keepAlive = new Audio(silentWav());
keepAlive.loop = true;
let keepAliveArmed = false;
let wakeLock = null;

function playSilence() {
  if (keepAliveArmed && keepAlive.paused) keepAlive.play().catch(() => {});
}

async function holdWakeLock() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch {}
}

function armKeepAlive() {
  keepAliveArmed = true;
  playSilence();
  holdWakeLock();
}

setInterval(playSilence, 60_000);
// A wake lock is dropped whenever the page is hidden; take it back on return.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { holdWakeLock(); playSilence(); }
});

addEventListener('pointerup', () => {
  goFullscreen();
  armKeepAlive();
  const test = q.get('sound');
  if (test === 'announce' || test === 'alarm') playCue(test);
});

for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = icon(el.dataset.icon, 32);
addEventListener('resize', fit);
applyTheme(false);
if (q.get('debug')) {
  setInterval(fit, 5000);   // keep the keep-alive status in the debug line fresh
  window.wb = { nextPhoto, applyTheme, evaNew: evaReplay, chime: playCue };   // step photos / themes / Eva from the console
}
fit();
show(resting());
tick();
setInterval(tick, 1000);
setInterval(rotate, ROTATE_MS);
loadPhotos().then(nextPhoto);
setInterval(nextPhoto, PHOTO_MS);
evaBlinkLoop();
if (q.get('eva') === 'new') setTimeout(evaReplay, 1500);
setInterval(loadPhotos, 30 * 60_000);   // the server swaps a few each hour
setInterval(moveNight, NIGHT_MOVE_MS);
connect();
