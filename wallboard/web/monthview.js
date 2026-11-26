// The month sheet's markup (ASC-41): HTML strings only, no DOM, so the same
// code draws the live sheet (app.js) and the sample boards in
// design/MonthCalendar.dc.html. Styles: `.mc-*` in
// styles.css, copied into the design file.
//
// view: { mode: 'month' | 'week', ym: "2026-11", day: "2026-11-26" } — `day`
// is the selected day in month mode and any day of the shown week in week mode.

import { icon } from './icons.js';
import { person } from './household.js';
import {
  WEEKDAY_SHORT, byDay, canStepMonth, canStepWeek, cellChips, dayLabel, monthGrid, monthLabel,
  toneOf, weekDays, weekLabel, weekLayout,
} from './month.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** A chip's colours: the one person's avatar colours, or neutral when it's shared. */
function toneStyle(e) {
  const t = toneOf(e);
  if (t === 'shared') return '';
  const p = person(t);
  return ` style="background:${p.bg};color:${p.fg}"`;
}

const avatar = (id) => {
  const p = person(id);
  return `<span class="avatar" style="width:32px;height:32px;background:${p.bg};color:${p.fg};font-size:13px">${esc(p.ini)}</span>`;
};

const chipText = (e) => `${e.allDay ? '' : `<span class="mc-ct">${esc(e.start)}</span>`}${esc(e.title)}`;
const chip = (e) => `<span class="mc-chip${toneOf(e) === 'shared' ? ' shared' : ''}"${toneStyle(e)}>${chipText(e)}</span>`;
const more = (n) => (n ? `<span class="mc-more">+${n} more</span>` : '');
const count = (n) => (n ? `<span class="mc-count">+${n}</span>` : '');

/** The whole sheet body. `entries` is the `month` panel; `today` the board's "YYYY-MM-DD". */
export function monthSheet(view, entries, today) {
  const grouped = byDay(entries);
  const month = view.mode !== 'week';
  const canPrev = month ? canStepMonth(view.ym, -1, today) : canStepWeek(view.day, -1, today);
  const canNext = month ? canStepMonth(view.ym, 1, today) : canStepWeek(view.day, 1, today);
  const toggle = ['month', 'week'].map((m) => `<button type="button" class="evd-day ${view.mode === m || (m === 'month' && month) ? 'on' : ''}" data-action="mc-mode" data-mode="${m}">${m === 'month' ? 'Month' : 'Week'}</button>`).join('');
  const head = `<div class="mc-head"><div class="mc-toggle">${toggle}</div>
    <h2 class="mc-title">${esc(month ? monthLabel(view.ym) : weekLabel(view.day))}</h2>
    <div class="mc-nav"><button type="button" class="round-btn" data-action="mc-step" data-dir="-1" aria-label="${month ? 'Last month' : 'Last week'}" ${canPrev ? '' : 'disabled'}>${icon('prev', 32, 2)}</button>
    <button type="button" class="round-btn" data-action="mc-step" data-dir="1" aria-label="${month ? 'Next month' : 'Next week'}" ${canNext ? '' : 'disabled'}>${icon('next', 32, 2)}</button></div></div>`;
  return `<div class="mc">${head}<div class="mc-body">${month ? monthBody(view, grouped, today) : weekBody(view, grouped, today)}</div></div>`;
}

function monthBody(view, grouped, today) {
  const wd = WEEKDAY_SHORT.map((d) => `<span class="mc-wd">${d}</span>`).join('');
  const cells = monthGrid(view.ym).flat().map((day) => {
    const { chips, more: n } = cellChips(grouped.get(day));
    const cls = ['mc-day', day.slice(0, 7) !== view.ym ? 'out' : '', day === today ? 'today' : '', day === view.day ? 'on' : ''].filter(Boolean).join(' ');
    const { weekday, date } = dayLabel(day);
    return `<button type="button" class="${cls}" data-action="mc-day" data-day="${day}" aria-label="${weekday} ${date}">
      <span class="mc-top"><span class="mc-n">${Number(day.slice(8))}</span>${count(n)}</span>${chips.map(chip).join('')}</button>`;
  }).join('');
  return `<div class="mc-grid">${wd}${cells}</div>${dayPanel(view.day, grouped.get(view.day) ?? [])}`;
}

/** The selected day's full list, beside the grid: the Today card's rows. */
function dayPanel(day, list) {
  const { weekday, date } = dayLabel(day);
  const rows = list.map((e) => {
    const chips = (e.who ?? []).map(avatar).join('');
    return `<div class="ev"><span class="t${e.allDay ? ' allday' : ''}">${e.allDay ? 'All day' : esc(e.start)}</span>
      <div class="body"><span class="title">${esc(e.title)}</span>${chips ? `<div class="meta">${chips}</div>` : ''}</div></div>`;
  }).join('');
  return `<div class="mc-side"><div class="mc-side-head"><span class="eyebrow">${esc(weekday)}</span><span class="mc-date">${esc(date)}</span></div>
    <div class="mc-list">${rows || '<div class="ev-empty">Nothing on the calendar</div>'}</div></div>`;
}

const share = (n, of) => `${((n / of) * 100).toFixed(3)}%`;

function weekBody(view, grouped, today) {
  const days = weekDays(view.day);
  const w = weekLayout(days, grouped);
  const span = (w.to - w.from) * 60;
  const pct = (m) => `${((m / span) * 100).toFixed(3)}%`;
  const heads = days.map((day, i) => `<div class="mc-wh${day === today ? ' today' : ''}"><span class="mc-wd">${WEEKDAY_SHORT[i]}</span><span class="mc-n">${Number(day.slice(8))}</span></div>`).join('');
  const allDay = w.days.map((d) => {
    const { chips, more: n } = cellChips(d.allDay);
    return `<div class="mc-ad">${chips.map(chip).join('')}${more(n)}</div>`;
  }).join('');
  const hours = Array.from({ length: w.to - w.from }, (_, i) => w.from + i);
  const lines = hours.map((h) => `<span class="mc-hl" style="top:${pct((h - w.from) * 60)}"></span>`).join('');
  const labels = hours.map((h) => `<span class="mc-hn" style="top:${pct((h - w.from) * 60)}">${h}:00</span>`).join('');
  const block = (t) => {
    const tone = toneOf(t.e);
    const p = tone === 'shared' ? null : person(tone);
    const style = `top:${pct(t.top)};height:${pct(t.height)};left:${share(t.lane, t.lanes)};width:${share(1, t.lanes)}${p ? `;background:${p.bg};color:${p.fg}` : ''}`;
    return `<div class="mc-blk${p ? '' : ' shared'}" style="${style}">${chipText(t.e)}</div>`;
  };
  const cols = w.days.map((d) => `<div class="mc-col${d.day === today ? ' today' : ''}">${lines}${d.timed.map(block).join('')}</div>`).join('');
  return `<div class="mc-week"><span></span>${heads}<span class="mc-adk">All day</span>${allDay}<div class="mc-hours">${labels}</div>${cols}</div>`;
}
