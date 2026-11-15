// The wallboard. Three views (ambient / active / night) on one fixed 1920×1080
// stage, one SSE stream carrying the server's state, and dummy content filling
// whatever Eva hasn't pushed yet.
//
// Test hooks (query string, combinable):
//   ?mode=ambient|active|night   pin the resting view instead of following the clock
//   ?time=21:45                  pretend it's this time (the clock still ticks)
//   ?debug=1                     show Silk's viewport size — DESIGN.md asks to confirm it

import { icon, star, weatherIcon } from './icons.js';
import { ORDER, person } from './household.js';
import { dummy } from './dummy.js';

const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);

const IDLE_MS = 60_000;          // active → resting view after a minute untouched
const TOAST_MS = 8_000;          // undo window
const LEAVE_WINDOW_MIN = 45;     // the leave-by card only exists inside this window
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

/** "7:55" / "18:30" → minutes since midnight. */
function parseHM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? ''));
  return m ? +m[1] * 60 + +m[2] : null;
}
const fmtHM = (d) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function isNight(d) {
  const m = minutesOfDay(d);
  return m >= 21 * 60 + 30 || m < 6 * 60 + 30;
}

// Themes by time of day (DESIGN.md): Morning paper 06:30–21:00, Haven Night
// (dark) until bedtime, then the night view. ?theme=day|evening pins it.
function themeFor(d) {
  const pinned = q.get('theme');
  if (pinned === 'day' || pinned === 'evening') return pinned;
  const m = minutesOfDay(d);
  return m >= 6 * 60 + 30 && m < 21 * 60 ? 'day' : 'evening';
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
const DUMMY = dummy(now());      // computed once so relative times stay put

// Pay and bath order live only in this browser for now (dummy, no server
// model yet). Persisted so a reload doesn't reset the experience.
let local = loadLocal();
function loadLocal() {
  try {
    const s = JSON.parse(localStorage.getItem('wallboard.local') ?? 'null');
    if (s && s.owed && s.bath) return s;
  } catch {}
  return {
    owed: { mariko: 1, sarina: 0 },
    paidToday: { mariko: false, sarina: false },
    bath: { tonight: 'sarina', history: ['sarina', 'mariko', 'sarina', 'sarina', 'mariko'] },
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

function note() {
  const n = content('note');
  if (!n) return null;
  return typeof n === 'string' ? { text: n } : n.text ? n : null;
}

function bathFirst() {
  return person(local.bath.tonight).name;
}

function schedule() {
  const items = (content('schedule') ?? []).map((e) => ({ ...e, sub: String(e.sub ?? '').replace('{bath}', bathFirst()) }));
  const lb = content('leave-by');
  if (lb?.at) items.push({ at: lb.at, title: lb.label, who: lb.who, leave: true });
  return items.filter((e) => parseHM(e.at) != null).sort((a, b) => parseHM(a.at) - parseHM(b.at));
}

function owedDays(id) {
  const g = choreGroups().find((x) => x.id === id);
  return (local.owed[id] ?? 0) + (g?.all && !local.paidToday[id] ? 1 : 0);
}
const days = (n) => `${n} ${n === 1 ? 'day' : 'days'}`;

// ---- render: ambient -----------------------------------------------------------

function renderAmbient() {
  const w = content('weather');
  if (w?.now) {
    const [ic, col] = weatherIcon(w.now.cond);
    $('amb-weather').innerHTML = `
      <div style="display:flex;color:${col}">${icon(ic, 72)}</div>
      <span class="amb-temp">${esc(w.now.temp)}°</span>
      <div class="amb-wtext"><b>${esc(w.now.label)}</b><span>${esc(w.summary ?? '')}</span></div>`;
  } else $('amb-weather').innerHTML = '';

  const right = [];
  const mins = leaveMinutes();
  if (mins != null) {
    const lb = content('leave-by');
    right.push(`<div class="leave">
      <div class="leave-head">${icon('leave', 32)}<span>${esc(lb.label)}</span></div>
      <div class="leave-mins"><span class="big">${mins}</span><span class="unit">min</span></div>
      <span class="leave-sub">${esc(names(lb.who))} · out the door by ${esc(lb.at)}</span></div>`);
  }
  const n = note();
  if (n) {
    right.push(`<div class="eva"><div class="eva-face">${icon('eva', 36)}</div>
      <div class="eva-body"><span class="eyebrow">Eva says</span><span class="eva-text">${esc(n.text)}</span></div></div>`);
  }
  const t = minutesOfDay(now());
  const later = schedule().filter((e) => !e.leave && parseHM(e.at) > t).slice(0, 3);
  right.push(`<div class="later"><span class="eyebrow">Later today</span>${
    later.length
      ? later.map((e) => `<div class="later-row"><span class="t">${esc(e.at)}</span><span class="w">${esc(e.title)}</span><span class="p">${esc(names(e.who))}</span></div>`).join('')
      : '<div class="later-row"><span class="p">Nothing else today</span></div>'
  }</div>`);
  $('amb-right').innerHTML = right.join('');

  const strip = choreGroups().filter((g) => person(g.id).kid).map((g) => {
    const owe = owedDays(g.id);
    return `<div class="strip-card strip-kid">${avatar(g.id, 56, 22)}
      <div class="info"><div class="row"><span class="name">${esc(g.p.name)}</span>
        <span class="status ${g.all ? 'all' : ''}">${g.all ? 'All done' : `${g.n} of ${g.items.length}`}</span>
        ${owe > 0 ? `<span class="owed">${days(owe)} to pay</span>` : ''}</div>
        <div class="segs">${g.items.map((c) => `<span class="${c.done ? 'on' : ''}"></span>`).join('')}</div></div></div>`;
  });
  strip.push(`<div class="strip-card strip-bath"><span style="display:flex;color:var(--cool)">${icon('drop', 32)}</span>
    <div class="strip-label"><span class="k">Bath first tonight</span><span class="v">${esc(bathFirst())}</span></div>
    <span style="margin-left:auto">${avatar(local.bath.tonight, 48, 18)}</span></div>`);
  const cd = (content('countdowns') ?? [])[0];
  if (cd) {
    strip.push(`<div class="strip-card strip-count"><span style="display:flex;color:var(--warm)">${icon(cd.icon ?? 'gift', 40)}</span>
      <div class="strip-label"><span class="k">${esc(cd.label)} in</span><span class="v"><span class="num" style="font-weight:400">${esc(cd.days)}</span> days</span></div></div>`);
  }
  $('amb-strip').innerHTML = strip.join('');
}

// Memories: two stacked layers, crossfaded, each drifting very slowly.
//
// Source, first that has anything: a `memories` panel Eva pushed, then the
// server's rotating set from the iCloud albums, then the dummy placeholders.
// Order is a shuffle bag: random, but nothing repeats until everything in the
// current set has been shown once.
//
// Layout per photo by width ÷ height (DESIGN.md): ≥ 1.2 full-bleed; ≤ 0.9
// portrait, paired with another portrait found within the next 5 in the bag;
// anything else, or a portrait with no partner, shown single in the left half.
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
const isPortrait = (p) => ratio(p) <= 0.9;

function refillBag(list) {
  const valid = new Set(list.map((p) => p.src));
  bag = bag.filter((p) => valid.has(p.src));
  if (!bag.length) {
    bag = list.slice();
    for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
  }
}

/** The next slide: one photo, or two portraits. Mutates the bag. */
function nextSlide(list) {
  refillBag(list);
  const first = bag.pop();
  if (!isPortrait(first)) return { layout: ratio(first) >= 1.2 ? 'full' : 'single', photos: [first] };
  for (let k = 1; k <= 5 && k <= bag.length; k++) {
    const i = bag.length - k;
    if (isPortrait(bag[i])) return { layout: 'pair', photos: [first, bag.splice(i, 1)[0]] };
  }
  return { layout: 'single', photos: [first] };
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
  const classes = slide.layout === 'pair' ? ['half l', 'half r'] : [slide.layout];
  let imgs;
  try {
    imgs = await Promise.all(slide.photos.map((p, i) => loadImg(p.src, classes[i])));
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
  $('amb-caption').innerHTML = cap ? `${icon('photo', 26)}<span>Memories · ${esc(cap)}${slide.layout === 'pair' ? ' · 2 photos' : ''}</span>` : '';
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
  const nextIdx = lm != null ? items.findIndex((e) => e.leave) : items.findIndex((e) => parseHM(e.at) > t);
  // Leave-by only appears in the list while it's still ahead.
  items = items.map((e, i) => ({ ...e, i })).filter((e) => !e.leave || parseHM(e.at) > t);
  while (items.length > 7 && parseHM(items[0].at) <= t) items.shift();
  $('act-schedule').innerHTML = `<div class="card-head"><span class="ico-muted">${icon('calendar', 32)}</span><span class="card-title">Today</span></div>${
    items.length ? items.map((e) => {
      const next = e.i === nextIdx;
      const past = parseHM(e.at) <= t;
      const until = parseHM(e.at) - t;
      const chips = (e.who ?? []).map((id) => avatar(id, 32, 13)).join('');
      const sub = next && until <= 60 ? `<span class="sub soon">in ${until} min</span>` : e.sub ? `<span class="sub">${esc(e.sub)}</span>` : '';
      return `<div class="ev ${next ? 'next' : ''} ${past ? 'past' : ''}"><span class="t">${esc(e.at)}</span>
        <div class="body"><span class="title">${esc(e.title)}</span>${chips || sub ? `<div class="meta">${chips}${sub}</div>` : ''}</div></div>`;
    }).join('') : '<div class="ev-empty">Nothing on today</div>'
  }`;

  renderChores();

  // Bath order (local dummy).
  const b = local.bath;
  const last = b.history[b.history.length - 1];
  const auto = last === 'mariko' ? 'sarina' : 'mariko';
  $('act-bath').innerHTML = `<div class="bath-row"><div class="bath-ico">${icon('drop', 32)}</div>
      <span class="bath-k">Bath first tonight</span>${avatar(b.tonight, 48, 18)}<span class="bath-v">${esc(bathFirst())}</span>
      <button type="button" class="pill-btn pill-neutral" style="margin-left:auto" data-action="swap">${icon('swap', 26, 2)}Swap</button></div>
    <div class="bath-hist"><span class="k">Went first</span>${b.history.map((id, i, a) =>
      `<span style="opacity:${i === a.length - 1 ? 1 : 0.55};display:flex">${avatar(id, 32, 12)}</span>`).join('')}
      <span class="note">Last night: ${esc(person(last).name)}${b.tonight === auto ? '' : ' · swapped tonight'}</span></div>`;

  // Right column: Eva, leave/pickup, dinner, countdowns.
  const side = [];
  const n = note();
  if (n) {
    side.push(`<div class="card side-eva"><div class="card-head"><div class="eva-face">${icon('eva', 30)}</div><span class="eyebrow">Eva says</span></div>
      <span class="text">${esc(n.text)}</span>${n.sub ? `<span class="sub">${esc(n.sub)}</span>` : ''}</div>`);
  }
  const pickup = content('pickup');
  if (lm != null || pickup) {
    const lb = content('leave-by');
    side.push(`<div class="card side-go ${lm != null ? 'glow' : ''}">${lm != null ? `
      <span class="eyebrow" style="color:var(--accent)">${esc(lb.label)}</span>
      <div class="mins"><span class="big">${lm}</span><span class="unit">min</span><span class="by">by ${esc(lb.at)}</span></div>
      ${pickup ? '<div class="rule"></div>' : ''}` : ''}
      ${pickup ? `<span class="eyebrow">Pickup</span><span class="v">${esc(pickup.text)}</span>` : ''}</div>`);
  }
  const dinner = content('dinner');
  if (dinner) {
    side.push(`<div class="card side-dinner"><span style="display:flex;color:var(--warm)">${icon('dinner', 36)}</span>
      <div style="display:flex;flex-direction:column"><span class="k">Tonight ${esc(dinner.at ?? '')}</span><span class="v">${esc(dinner.text)}</span></div></div>`);
  }
  const cds = content('countdowns') ?? [];
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
  const owe = owedDays(g.id);
  let color, a, b, can = false;
  if (owe > 0) {
    color = 'var(--warm)'; a = `${days(owe)} to pay`; can = true;
    b = (local.owed[g.id] ?? 0) > 0 ? (g.all ? 'Includes today' : 'Today not finished yet') : 'Earned today';
  } else if (local.paidToday[g.id]) {
    color = 'var(--success)'; a = 'Paid up'; b = 'Today included';
  } else {
    color = 'var(--ink-muted)'; a = 'Nothing owed'; b = `Finish all ${g.items.length} to earn today`;
  }
  return `<span style="display:flex;color:${color}">${icon('pay', 30)}</span>
    <div class="txt"><span class="a" style="color:${color}">${a}</span><span class="b">${b}</span></div>
    ${can ? `<button type="button" class="pill-btn pill-warm" data-action="pay" data-who="${esc(g.id)}">Mark paid</button>` : ''}`;
}

// ---- render: night -------------------------------------------------------------

function renderNight() {
  const w = content('weather')?.night;
  $('night-weather').innerHTML = w ? `<span style="display:flex">${icon(weatherIcon(w.cond)[0], 30)}</span><span>${esc(w.text)}</span>` : '';
  const tm = content('tomorrow');
  $('night-tomorrow').innerHTML = tm ? `<span class="num">${esc(tm.at)}</span><span>${esc(tm.title)}</span>` : '';
}

// Night burn-in: the block jumps somewhere new every 10 minutes.
function moveNight() {
  const el = $('night-block');
  el.style.opacity = '0';
  setTimeout(() => {
    el.style.left = `${120 + Math.round(Math.random() * (stageW - 1020))}px`;
    el.style.top = `${100 + Math.round(Math.random() * 420)}px`;
    el.style.opacity = '1';
  }, 1600);
}

function renderAll() {
  if (view === 'ambient') renderAmbient();
  else if (view === 'active') renderActive();
  else if (view === 'night') renderNight();
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

function pay(who) {
  const n = owedDays(who);
  const g = choreGroups().find((x) => x.id === who);
  changeLocal(() => {
    local.owed[who] = 0;
    local.paidToday[who] = !!g?.all;
  }, { ok: true, title: `Paid ${person(who).name}`, sub: `${days(n)} of chores · Eva noted it` });
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

addEventListener('pointerup', () => { goFullscreen(); armKeepAlive(); });

for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = icon(el.dataset.icon, 32);
addEventListener('resize', fit);
applyTheme(false);
if (q.get('debug')) {
  setInterval(fit, 5000);   // keep the keep-alive status in the debug line fresh
  window.wb = { nextPhoto, applyTheme };   // step photos / themes from the console
}
fit();
show(resting());
tick();
setInterval(tick, 1000);
loadPhotos().then(nextPhoto);
setInterval(nextPhoto, PHOTO_MS);
setInterval(loadPhotos, 30 * 60_000);   // the server swaps a few each hour
setInterval(moveNight, NIGHT_MOVE_MS);
connect();
