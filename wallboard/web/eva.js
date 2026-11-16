// Eva on the board: a small robot version of the desk face, with a speech
// bubble. Port of design/EvaCharacter.dc.html (character), EvaOptA /
// EvaEvening / EvaDayPortrait (calm placement), EvaActive, EvaNight and
// EvaStates (motion). CLAUDE.md "Eva bubble" has the rules.
//
// Two halves, same split as the rest of the board:
// - `evaSvg()` and `stripEmoji()` are pure: markup in, markup out.
// - `EvaSpot` is one place Eva appears (calm, active, night). It owns its DOM
//   and only touches it when something actually changes, so the board's
//   frequent re-renders never restart a blink or a pop mid-flight.
//
// Silk budget: transforms and opacity only. The eye glow is two translucent
// larger rects, never a blur filter. Colours come from CSS variables
// (--eva-shell, --eva-edge, --eva-z) so the theme crossfade recolours her
// without a re-render.

const MINT = '#7cf2c4';
const DIM = '#3f8f73';     // asleep: antenna, eyes and mouth

// Eyes: the desk's 104 × 132 (radius 9, gap 300) scaled ×0.16, plus two glow rects.
const eye = (x) => `<rect x="${(x - 6).toFixed(1)}" y="52.0" width="28.6" height="33.1" rx="7" fill="${MINT}" opacity="0.14"/>`
  + `<rect x="${(x - 2.5).toFixed(1)}" y="55.5" width="21.6" height="26.1" rx="3.5" fill="${MINT}" opacity="0.32"/>`
  + `<rect x="${x.toFixed(1)}" y="58.0" width="16.6" height="21.1" rx="1.5" fill="${MINT}"/>`;
const caret = (x) => `<path d="M${x.toFixed(1)} 77.0l9.3 -15 9.3 15" fill="none" stroke="${MINT}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" opacity="0.25"/>`
  + `<path d="M${x.toFixed(1)} 77.0l9.3 -15 9.3 15" fill="none" stroke="${MINT}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`;
const shut = (x) => `<path d="M${x.toFixed(1)} 70.0q8.3 6 16.6 0" fill="none" stroke="${DIM}" stroke-width="4" stroke-linecap="round"/>`;
const sparkle = (cx, cy, r, fill) =>
  `<path d="M${cx} ${cy - r}q${r * 0.2} ${r * 0.8} ${r} ${r}q${-r * 0.8} ${r * 0.2} ${-r} ${r}q${-r * 0.2} ${-r * 0.8} ${-r} ${-r}q${r * 0.8} ${-r * 0.2} ${r} ${-r}z" fill="${fill}"/>`;

const FACES = {
  happy: {
    eyes: eye(59.4) + eye(124.0),
    mouth: `<path d="M88 99q12 10 24 0" fill="none" stroke="${MINT}" stroke-width="4" stroke-linecap="round"/>`,
  },
  excited: {
    eyes: caret(58.4) + caret(123.0),
    mouth: `<path d="M86 94h28a14 13 0 0 1-28 0z" fill="${MINT}"/>`,
    above: `<g class="eva-sparkles">${sparkle(22, 26, 9, '#f2c27a')}${sparkle(182, 20, 7, MINT)}${sparkle(190, 52, 5, '#f5b3c8')}</g>`,
  },
  sleepy: {
    eyes: shut(59.4) + shut(124.0),
    mouth: `<circle cx="100" cy="100" r="3.5" fill="none" stroke="${DIM}" stroke-width="3"/>`,
    above: '<text class="eva-z" x="150" y="26" font-family="Space Grotesk, Inter, sans-serif" font-size="22" font-weight="700">z</text>'
      + '<text class="eva-z" x="168" y="12" font-family="Space Grotesk, Inter, sans-serif" font-size="15" font-weight="700">z</text>',
  },
};

/**
 * The character. `expr`: happy | excited | sleepy. `theme`: 'day' | 'dark', or
 * omit to follow the stage's theme. `size`: rendered width in px. `peek`: head
 * and shoulders only (no neck or body), for sitting behind something.
 */
export function evaSvg({ expr = 'happy', theme, size = 170, peek = false } = {}) {
  const f = FACES[expr] ?? FACES.happy;
  const glow = expr === 'sleepy' ? DIM : MINT;
  const h = peek ? 150 : 192;
  const body = peek ? '' : '<rect class="eva-edge-fill" x="88" y="140" width="24" height="10"/>'
    + '<rect class="eva-shell" x="54" y="146" width="92" height="42" rx="16" stroke-width="3"/>'
    + `<circle cx="100" cy="166" r="6" fill="${glow}" opacity="0.85"/>`;
  return `<svg class="eva-svg${theme ? ` eva-t-${theme}` : ''}" width="${size}" height="${Math.round((size * h) / 200)}" viewBox="0 0 200 ${h}" role="img" aria-label="Eva, ${expr}" style="display:block;overflow:visible">`
    + (f.above ?? '')
    + '<path class="eva-edge-line" d="M100 31V12" stroke-width="4" stroke-linecap="round"/>'
    + `<circle cx="100" cy="10" r="7.5" fill="${glow}"/>`
    + '<rect class="eva-shell" x="6" y="70" width="14" height="32" rx="6" stroke-width="3"/>'
    + '<rect class="eva-shell" x="180" y="70" width="14" height="32" rx="6" stroke-width="3"/>'
    + body
    + '<rect class="eva-shell" x="16" y="30" width="168" height="112" rx="34" stroke-width="3"/>'
    + '<rect x="30" y="44" width="140" height="84" rx="22" fill="#0b0e12"/>'
    + `<g class="eva-eyes">${f.eyes}</g>${f.mouth}</svg>`;
}

/** Eva's text never carries emoji on the board (CLAUDE.md); later they may map to icons. */
export function stripEmoji(s) {
  return String(s ?? '')
    .replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}️‍⃣]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim();
}

/**
 * Normalize a pushed `eva` (or legacy `note`) panel: `{text, sub?, mood?, at?}`
 * or a bare string. Null means "nothing to say": no bubble.
 */
export function evaMessage(data) {
  const d = typeof data === 'string' ? { text: data } : data;
  if (!d || typeof d !== 'object') return null;
  const text = stripEmoji(d.text);
  if (!text) return null;
  return {
    text,
    sub: stripEmoji(d.sub) || null,
    mood: d.mood === 'excited' ? 'excited' : 'happy',
    at: typeof d.at === 'string' ? d.at : null,
  };
}

/** Same message? Arrival plays only when this changes. */
export const evaSig = (m) => (m ? JSON.stringify([m.text, m.sub, m.at]) : '');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const bubbleHtml = (m, cls = '') => `<div class="eva-bubble${cls}"><span class="eva-tail" aria-hidden="true"></span>`
  + `<span class="eva-text">${esc(m.text)}</span>${m.sub ? `<span class="eva-sub">${esc(m.sub)}</span>` : ''}</div>`;

/** One place Eva appears. `bubble` is null where she has nothing to say (night). */
export class EvaSpot {
  constructor(eva, bubble, { size, peek = false, theme } = {}) {
    Object.assign(this, { eva, bubble, size, peek, theme });
    this.expr = null;
    this.sig = null;
  }

  setExpr(expr) {
    if (expr === this.expr) return;
    this.expr = expr;
    // The face lives in its own wrapper so a hop on the wrapper survives a swap.
    this.eva.innerHTML = `<div class="eva-body">${evaSvg({ expr, theme: this.theme, size: this.size, peek: this.peek })}</div>`;
  }

  /** Put a message up now, no motion (first paint, reduced motion, hidden views). */
  setMessage(m, { pop = false } = {}) {
    if (!this.bubble) return;
    const sig = evaSig(m);
    if (sig === this.sig && !pop) return;
    this.sig = sig;
    this.bubble.innerHTML = m ? bubbleHtml(m, pop ? ' pop' : '') : '';
  }

  /** Step 1 of an arrival: the old bubble fades (150 ms). */
  fadeOut() {
    this.bubble?.firstElementChild?.classList.add('out');
  }

  hop() { this.replay('eva-body', 'hop'); }

  blink(double = false) {
    if (this.expr === 'sleepy') return;
    const g = this.eva.querySelector('.eva-eyes');
    if (!g) return;
    g.classList.remove('blink', 'blink2');
    void g.getBoundingClientRect();      // restart the one-shot animation
    g.classList.add(double ? 'blink2' : 'blink');
    g.addEventListener('animationend', () => g.classList.remove('blink', 'blink2'), { once: true });
  }

  replay(sel, cls) {
    const el = this.eva.querySelector(`.${sel}`);
    if (!el) return;
    el.classList.remove(cls);
    void el.getBoundingClientRect();
    el.classList.add(cls);
    el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
  }
}
