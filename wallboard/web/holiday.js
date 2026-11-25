// Holiday touches (ASC-40). Pure: dates in, strings out, so it is testable
// without a DOM. Two things live here:
//
// 1. Which big holiday today is (`holidayOn`), and what the board wears on
//    that day: a garland of the holiday's motifs across the top of the photo
//    and a badge + coloured ring on Eva's bubble. Static: nothing loops.
// 2. The featured character for each big holiday's countdown party
//    (`heroHtml`): a turkey struts, a ghost floats, Santa's sleigh flies,
//    Cupid flies, the year's zodiac sign (干支) rises. One element riding
//    one CSS animation, on top of the kind's particles (app.js `sky()`).
//
// Drafted straight from the board's own particle palette (celebrate.js) and
// tokens; there is no design file yet (CLAUDE.md "Holidays").

const pad = (n) => String(n).padStart(2, '0');

/** The nth (1-based) weekday `wd` (0 = Sunday) of month `m` (1-based) in year `y`, as a day of the month. */
function nthWeekday(y, m, wd, n) {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
}

/** Kinds that get a holiday day and a featured character, with their own countdown kind names. */
export const BIG = ['new-year', 'valentine', 'halloween', 'thanksgiving', 'christmas'];

/**
 * The big holiday on the board's local date, or null.
 * @param {number} y  full year
 * @param {number} m  month, 1-based
 * @param {number} d  day of the month
 */
export function holidayOn(y, m, d) {
  if (m === 1 && d === 1) return 'new-year';
  if (m === 2 && d === 14) return 'valentine';
  if (m === 10 && d === 31) return 'halloween';
  if (m === 11 && d === nthWeekday(y, 11, 4, 4)) return 'thanksgiving';
  if (m === 12 && d === 25) return 'christmas';
  return null;
}

// The Japanese zodiac (干支), as on a nengajō: the sign changes on 1 January.
const ZODIAC = [
  ['子', 'Rat'], ['丑', 'Ox'], ['寅', 'Tiger'], ['卯', 'Rabbit'], ['辰', 'Dragon'], ['巳', 'Snake'],
  ['午', 'Horse'], ['未', 'Sheep'], ['申', 'Monkey'], ['酉', 'Rooster'], ['戌', 'Dog'], ['亥', 'Boar'],
];
/** The zodiac sign of a year: { kanji, name }. 2020 was the Rat. */
export function zodiac(year) {
  const [kanji, name] = ZODIAC[(((year - 2020) % 12) + 12) % 12];
  return { kanji, name };
}

// ---- palette -----------------------------------------------------------------
// celebrate.js's particle colours, plus the board's ink, cream and green.
const C = {
  wine: '#8c2a4f', pink: '#f5b3c8', amber: '#934606', gold: '#f2c27a', violet: '#4a3480',
  lavender: '#c9b6f5', blue: '#24559e', mint: '#8fd3c8', green: '#2f6b3c', cream: '#fffaf1',
  ink: '#1d1712', brown: '#5f5345', edge: '#c9b89c',
};

// ---- small drawings (24 grid unless noted) -----------------------------------

const HEART = 'M12 20s-7-4.4-8.5-9A4.5 4.5 0 0 1 12 6.5 4.5 4.5 0 0 1 20.5 11C19 15.6 12 20 12 20z';
const LEAF = 'M5 19C5 10 10 4 20 4c0 10-6 15-15 15z';
const STAR = 'M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8 6.6 19.7l1.1-6.1-4.5-4.2 6.1-.8z';

/** Filled motifs, each a function of colour → SVG body on a 24 × 24 grid. */
const MOTIF = {
  heart: (c) => `<path d="${HEART}" fill="${c}"/>`,
  leaf: (c) => `<path d="${LEAF}" fill="${c}"/><path d="M5 19l8-8" stroke="${C.cream}" stroke-width="1.4" stroke-linecap="round" opacity=".6"/>`,
  star: (c) => `<path d="${STAR}" fill="${c}"/>`,
  pumpkin: (c) => `<path d="M12 7c-4.5 0-8.5 2.5-8.5 7s4 7 8.5 7 8.5-2.5 8.5-7-4-7-8.5-7z" fill="${c}"/>`
    + `<path d="M8.2 7.7c-1.6 2.5-1.6 10.1 0 12.6M15.8 7.7c1.6 2.5 1.6 10.1 0 12.6" stroke="${C.gold}" stroke-width="1.3" fill="none" opacity=".7"/>`
    + `<path d="M12 7c0-2 1-3.5 3-4" stroke="${C.green}" stroke-width="2" fill="none" stroke-linecap="round"/>`,
  ghost: () => `<path d="M12 2.5c-4.4 0-7.5 3.4-7.5 7.8V21l2.5-2 2.5 2 2.5-2 2.5 2 2.5-2 2.5 2V10.3c0-4.4-3.1-7.8-7.5-7.8z" fill="${C.cream}" stroke="${C.lavender}" stroke-width="1.2"/>`
    + `<ellipse cx="9.5" cy="10" rx="1.3" ry="1.9" fill="${C.ink}"/><ellipse cx="14.5" cy="10" rx="1.3" ry="1.9" fill="${C.ink}"/><ellipse cx="12" cy="14.5" rx="1.4" ry="1.8" fill="${C.ink}"/>`,
  ornament: (c) => `<rect x="10" y="1.5" width="4" height="3.5" rx=".8" fill="${C.gold}"/><circle cx="12" cy="14" r="8.5" fill="${c}"/>`
    + `<path d="M7 11.5a6 6 0 0 1 4-4" stroke="${C.cream}" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".7"/>`,
  arrow: (c) => `<path d="M4.5 19.5L19 5" stroke="${c}" stroke-width="2" stroke-linecap="round"/><path d="M20 4l-6 1.5 4.5 4.5z" fill="${c}"/>`
    + `<path d="M4.5 19.5l.5-4M4.5 19.5l4-.5M6.5 17.5l.5-4M6.5 17.5l4-.5" stroke="${C.pink}" stroke-width="1.6" stroke-linecap="round"/>`,
  plum: (c) => [0, 72, 144, 216, 288].map((a) => `<circle cx="12" cy="6.8" r="4" fill="${c}" transform="rotate(${a} 12 12)"/>`).join('')
    + `<circle cx="12" cy="12" r="2.4" fill="${C.gold}"/>`,
};
const svg24 = (body, extra = '') => `<svg width="100%" height="100%" viewBox="0 0 24 24" aria-hidden="true"${extra}>${body}</svg>`;

/** One particle look for a party: SVG markup in `colour`. Unknown names draw nothing. */
export const motifSvg = (name, colour) => (MOTIF[name] ? svg24(MOTIF[name](colour)) : '');

// ---- the day itself ------------------------------------------------------------

/**
 * What each big holiday wears on its day. `garland` is the motif sequence
 * hung across the top of the photo, `badge` the motif on Eva's bubble,
 * `ring` the bubble's highlight (day theme, evening theme).
 */
export const DECOR = {
  'new-year': { garland: [['plum', C.pink], ['star', C.gold], ['plum', C.wine], ['star', C.gold]], badge: ['plum', C.wine], ring: [C.wine, C.pink] },
  valentine: { garland: [['heart', C.wine], ['heart', C.pink], ['arrow', C.amber], ['heart', C.pink]], badge: ['heart', C.wine], ring: [C.wine, C.pink] },
  halloween: { garland: [['pumpkin', C.amber], ['ghost'], ['pumpkin', C.amber], ['star', C.violet]], badge: ['pumpkin', C.amber], ring: [C.violet, C.lavender] },
  thanksgiving: { garland: [['leaf', C.amber], ['leaf', C.gold], ['leaf', C.wine], ['leaf', C.gold]], badge: ['leaf', C.amber], ring: [C.amber, C.gold] },
  christmas: { garland: [['ornament', C.wine], ['star', C.gold], ['ornament', C.green], ['ornament', C.blue], ['star', C.gold], ['ornament', C.gold]], badge: ['ornament', C.wine], ring: [C.green, C.mint] },
};

const GARLAND_W = 1920;
const GARLAND_H = 78;
const SWAGS = 12;
const MOTIF_PX = 40;

/**
 * The garland across the top of the stage: a string in swags, one motif
 * hanging at each swag's low point. One static SVG, 1920 × 76.
 */
export function garlandSvg(kind) {
  const decor = DECOR[kind];
  if (!decor) return '';
  const w = GARLAND_W / SWAGS;
  let string = 'M0 6';
  const hangs = [];
  for (let i = 0; i < SWAGS; i++) {
    const x0 = i * w;
    string += ` Q${x0 + w / 2} 46 ${x0 + w} 6`;
    const [name, colour] = decor.garland[i % decor.garland.length];
    const cx = x0 + w / 2;
    hangs.push(`<svg x="${cx - MOTIF_PX / 2}" y="${GARLAND_H - MOTIF_PX - 4}" width="${MOTIF_PX}" height="${MOTIF_PX}" viewBox="0 0 24 24">${MOTIF[name](colour)}</svg>`);
  }
  return `<svg width="${GARLAND_W}" height="${GARLAND_H}" viewBox="0 0 ${GARLAND_W} ${GARLAND_H}" aria-hidden="true">`
    + `<path d="${string}" fill="none" stroke="${C.edge}" stroke-width="2.5" stroke-linecap="round"/>${hangs.join('')}</svg>`;
}

/** Eva's bubble badge as a CSS `url()` (an SVG data URI), or '' when today is no big holiday. */
export function badgeUrl(kind) {
  const decor = DECOR[kind];
  if (!decor) return '';
  const [name, colour] = decor.badge;
  const s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${MOTIF[name](colour)}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(s)}")`;
}

// ---- the featured character in a countdown party ---------------------------------

/** Which countdown kinds bring a featured character, and how it moves (styles.css `.wb-hero.<move>`). */
export const HERO_MOVE = {
  thanksgiving: 'strut', halloween: 'float', christmas: 'fly', valentine: 'fly', 'new-year': 'rise',
};

function turkey() {
  const fan = [C.wine, C.gold, C.amber, C.gold, C.wine];
  return `<svg width="220" height="220" viewBox="0 0 120 120" aria-hidden="true">`
    + `<g transform="translate(60 74)">${[-64, -32, 0, 32, 64].map((a, i) => `<ellipse cx="0" cy="-30" rx="13" ry="32" fill="${fan[i]}" transform="rotate(${a})"/>`).join('')}</g>`
    + `<path d="M51 98v14M69 98v14M45 112h12M63 112h12" stroke="${C.gold}" stroke-width="4" stroke-linecap="round"/>`
    + `<ellipse cx="60" cy="80" rx="26" ry="24" fill="${C.brown}"/>`
    + `<circle cx="60" cy="50" r="13" fill="${C.brown}"/>`
    + `<circle cx="55" cy="47" r="3.4" fill="${C.cream}"/><circle cx="65" cy="47" r="3.4" fill="${C.cream}"/>`
    + `<circle cx="55.6" cy="47.6" r="1.7" fill="${C.ink}"/><circle cx="65.6" cy="47.6" r="1.7" fill="${C.ink}"/>`
    + `<path d="M56 53l4 6 4-6z" fill="${C.gold}"/><path d="M61.5 57c3 2 3 7 0 9-2-2-2-6 0-9z" fill="${C.wine}"/>`
    + `</svg>`;
}

function ghost() {
  return `<svg width="200" height="240" viewBox="0 0 100 120" aria-hidden="true">`
    + `<path d="M50 6C26 6 12 26 12 50v58l13-10 12 10 13-10 13 10 12-10 13 10V50C88 26 74 6 50 6z" fill="${C.cream}" stroke="${C.lavender}" stroke-width="3"/>`
    + `<ellipse cx="38" cy="48" rx="6" ry="9" fill="${C.ink}"/><ellipse cx="62" cy="48" rx="6" ry="9" fill="${C.ink}"/>`
    + `<ellipse cx="50" cy="72" rx="7" ry="10" fill="${C.ink}"/>`
    + `<path d="M12 62c-8 0-12-6-10-12M88 62c8 0 12-6 10-12" stroke="${C.lavender}" stroke-width="3" fill="none" stroke-linecap="round"/>`
    + `</svg>`;
}

function sleigh() {
  return `<svg width="420" height="175" viewBox="0 0 240 100" aria-hidden="true">`
    // reindeer, leading to the right
    + `<path d="M120 58C140 50 160 48 172 52" stroke="${C.gold}" stroke-width="2" fill="none"/>`
    + `<path d="M176 60l-6 16M184 60l2 16M204 60l-4 16M210 58l8 14" stroke="${C.amber}" stroke-width="4" stroke-linecap="round"/>`
    + `<ellipse cx="192" cy="54" rx="24" ry="11" fill="${C.amber}"/>`
    + `<path d="M210 48l6-12" stroke="${C.amber}" stroke-width="7" stroke-linecap="round"/>`
    + `<ellipse cx="222" cy="34" rx="10" ry="7" fill="${C.amber}"/><circle cx="232" cy="35" r="3.5" fill="${C.wine}"/>`
    + `<circle cx="222" cy="31" r="1.6" fill="${C.ink}"/>`
    + `<path d="M216 28c-2-8-8-12-14-12M216 28c0-8 4-14 10-16M206 18l-4-6" stroke="${C.brown}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`
    // sack and Santa
    + `<circle cx="58" cy="42" r="15" fill="${C.amber}"/><path d="M52 28l6 4 6-4" stroke="${C.gold}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`
    + `<ellipse cx="90" cy="46" rx="16" ry="14" fill="${C.wine}"/>`
    + `<circle cx="92" cy="26" r="9" fill="${C.pink}"/>`
    + `<path d="M83 28c0 10 5 14 9 14s9-4 9-14c-3 3-15 3-18 0z" fill="${C.cream}"/>`
    + `<path d="M83 22c2-9 12-12 20-6l-4 6z" fill="${C.wine}"/><circle cx="104" cy="15" r="3.5" fill="${C.cream}"/>`
    + `<circle cx="95" cy="25" r="1.4" fill="${C.ink}"/>`
    // the sleigh in front of them both
    + `<path d="M36 52h92l-10 26H52c-10 0-16-10-16-26z" fill="${C.wine}"/>`
    + `<path d="M36 52h92" stroke="${C.gold}" stroke-width="3" stroke-linecap="round"/>`
    + `<path d="M56 78v8M108 78v8M30 90h96c8 0 12-4 12-10" stroke="${C.gold}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`
    + `</svg>`;
}

function cupid() {
  const wing = `M60 46C44 22 18 22 6 32c12 2 18 8 22 14-9 0-15 4-17 10 15-5 28-3 40 4z`;
  return `<svg width="300" height="190" viewBox="0 0 160 100" aria-hidden="true">`
    + `<path d="${wing}" fill="${C.cream}" stroke="${C.lavender}" stroke-width="2.5" stroke-linejoin="round"/>`
    + `<path d="${wing}" fill="${C.cream}" stroke="${C.lavender}" stroke-width="2.5" stroke-linejoin="round" transform="translate(160 0) scale(-1 1)"/>`
    + `<path d="M30 78L118 28" stroke="${C.amber}" stroke-width="3" stroke-linecap="round"/>`
    + `<path transform="translate(56 24) scale(2)" d="${HEART}" fill="${C.wine}"/>`
    + `<path d="M98 40L118 28" stroke="${C.amber}" stroke-width="3" stroke-linecap="round"/>`
    + `<path d="M124 24l-12 1 6 9z" fill="${C.amber}"/>`
    + `<path d="M30 78l1-9M30 78l9-1M35 75l1-9M35 75l9-1" stroke="${C.pink}" stroke-width="3" stroke-linecap="round"/>`
    + `</svg>`;
}

function seal(year) {
  const z = zodiac(year);
  return `<span class="wb-seal"><span class="wb-seal-kanji">${z.kanji}</span></span><span class="wb-seal-name">Year of the ${z.name}</span>`;
}

/**
 * The featured character for a countdown party, or '' when the kind has none.
 * @param {string} kind  the countdown's kind
 * @param {number} year  the year the countdown lands in (the zodiac sign for `new-year`)
 */
export function heroHtml(kind, year) {
  const move = HERO_MOVE[kind];
  if (!move) return '';
  const art = { thanksgiving: turkey, halloween: ghost, christmas: sleigh, valentine: cupid, 'new-year': () => seal(year) }[kind]();
  return `<span class="wb-hero ${move}"><span class="wb-hero-in">${art}</span></span>`;
}
