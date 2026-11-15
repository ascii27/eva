// Inline SVG icons. The first group is copied from the Haven design system's
// Icon component (the design references them as Haven.Icon); the rest are the
// one-off glyphs drawn inline in the design boards. All 24×24, stroked.

const HAVEN = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  leave: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16l-4-4 4-4M6 12h10"/>',
  drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/>',
};

const GLYPHS = {
  eva: '<rect x="3" y="5" width="18" height="14" rx="5"/><circle cx="9" cy="12" r="1.4" fill="currentColor"/><circle cx="15" cy="12" r="1.4" fill="currentColor"/>',
  photo: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="M21 16l-5-5-8 8"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>',
  chores: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8 12.5l3 3 5-6"/>',
  gift: '<rect x="4" y="10" width="16" height="10" rx="1.5"/><path d="M3 7h18v3H3zM12 7v13M12 7c-1.5-3.5-5.5-3-4.5 0M12 7c1.5-3.5 5.5-3 4.5 0"/>',
  dinner: '<path d="M7 3v7M5 3v5a2 2 0 0 0 4 0V3M7 10v11M17 21V3c-2 1-3 4-3 7s1 3 3 3"/>',
  pay: '<circle cx="12" cy="12" r="9"/><path d="M8.5 7l3.5 5 3.5-5M12 12v6M9 13.5h6M9 16h6"/>',
  swap: '<path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
  undo: '<path d="M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  bath: '<path d="M3 12h18v3a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5zM6 12V6a2 2 0 0 1 4 0M7 20l-1 2M17 20l1 2"/>',
};

// Chore icons, keyed by the `icon` field hermes sends with a chore.
const CHORES = {
  bed: '<path d="M3 19v-8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8M3 15h18M6 9V6.5A1.5 1.5 0 0 1 7.5 5h3A1.5 1.5 0 0 1 12 6.5V9"/>',
  bag: '<path d="M6 9a6 6 0 0 1 12 0v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2zM9.5 3.5h5M9 14h6v3H9z"/>',
  table: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3.5"/><path d="M2.5 5v14M21.5 5v14"/>',
  shoes: '<path d="M3 17V9h4l2 3 5 1.5c3 .8 7 1.5 7 4.5H3zM3 17v2h18v-2M11 12.5l-1 2M14 13.4l-1 2"/>',
  laundry: '<path d="M8 4L3 7l2 4 2-1v10h10V10l2 1 2-4-5-3c-.5 1.7-2 2.5-4 2.5S8.5 5.7 8 4z"/>',
  plants: '<path d="M12 21v-8M12 13c0-4 3-6 7-6 0 4-3 6-7 6zM12 15c0-3-2.5-5-6-5 0 3 2.5 5 6 5zM8 21h8"/>',
};

// Schedule and bring icons, keyed by the `icon` field on a schedule entry or a
// bring item. Paths copied from design/DayFlow.dc.html (drawn at 1.9 stroke).
const SCHEDULE = {
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  swim: '<path d="M2.5 16c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 3-1.5M2.5 20c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 3-1.5M8 12l3.5-5 4 2.5"/><circle cx="17.5" cy="6" r="1.8"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  tooth: '<path d="M7 3c-2.5 0-4 2-4 4.5 0 3 2 4.5 2.5 8S7 21 8 21s1.5-3 2-5 1-2 2-2 1.5 0 2 2 1 5 2 5 1.5-2 2.5-5.5S21 10.5 21 7.5C21 5 19.5 3 17 3c-2 0-3 1-5 1S9 3 7 3z"/>',
  car: '<path d="M3 17h18v-4l-2.5-5h-13L3 13zM3 13h18M7 17v2.5M17 17v2.5"/>',
  work: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2M3 12.5h18"/>',
  tennis: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6c3.5 3.5 3.5 9.3 0 12.8M18.4 5.6c-3.5 3.5-3.5 9.3 0 12.8"/>',
  umbrella: '<path d="M3 12a9 9 0 0 1 18 0zM12 12v6.5a2 2 0 0 1-4 0"/>',
  towel: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M5 8h14M9 13h6"/>',
  recorder: '<path d="M14 3l7 7-11 11-3-1-1-3z"/><circle cx="13" cy="9" r=".8" fill="currentColor"/><circle cx="10.5" cy="11.5" r=".8" fill="currentColor"/><circle cx="8" cy="14" r=".8" fill="currentColor"/>',
};


// Countdown kinds (design/EventIcons.dc.html, CLAUDE.md "Countdown kinds"),
// copied verbatim; keys are the table's Icon column. gift, bag and music were
// already here with the same art. Two exceptions: Haven's `moon` (bedtime,
// night) and `sun` (weather) keep their art, so Tsukimi's moon-and-dango is
// `tsukimi`, and Summer uses Haven's sun.
const EVENTS = {
  star: '<path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8 6.6 19.7l1.1-6.1-4.5-4.2 6.1-.8z"/>',
  cake: '<path d="M4 21h16M5 21v-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7M5 16.5c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0M12 12V8.5M12 6.5c.9-.9.9-2 0-3-.9 1-.9 2.1 0 3z"/>',
  plane: '<path d="M21 12.5c0-.8-.7-1.5-1.5-1.5H15L10 3H8l2.5 8H6L4.5 9H3l1 3.5L3 16h1.5L6 14h4.5L8 22h2l5-8h4.5c.8 0 1.5-.7 1.5-1.5z"/>',
  box: '<path d="M3 8l9-5 9 5v8l-9 5-9-5zM3 8l9 5 9-5M12 13v8M7.5 5.5l9 5"/>',
  heart: '<path d="M12 20s-7-4.4-8.5-9A4.5 4.5 0 0 1 12 6.5 4.5 4.5 0 0 1 20.5 11C19 15.6 12 20 12 20z"/>',
  medal: '<path d="M7 3l3.5 7.5M17 3l-3.5 7.5"/><circle cx="12" cy="15.5" r="5.5"/><path d="M12 13v5M10.5 14l1.5-1"/>',
  cap: '<path d="M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5M22 9v6"/>',
  sunrise: '<path d="M2.5 17h19M6 17a6 6 0 0 1 12 0M12 5v3M5.6 8.6l2 2M18.4 8.6l-2 2M5 21h14"/>',
  oni: '<path d="M5.5 11a6.5 6.5 0 0 0 13 0v-1a6.5 6.5 0 0 0-13 0zM7.5 5L6 2M16.5 5L18 2M9 15h6"/><circle cx="9.5" cy="10.5" r=".9" fill="currentColor"/><circle cx="14.5" cy="10.5" r=".9" fill="currentColor"/>',
  dolls: '<circle cx="8" cy="5" r="2.2"/><circle cx="16" cy="5" r="2.2"/><path d="M3.5 21L8 8.5l4.5 12.5zM11.5 21L16 8.5l4.5 12.5z"/>',
  sakura: '<g><g transform="rotate(0 12 12)"><path d="M12 10c-1.8-2.6-1.3-5.6 0-6.8 1.3 1.2 1.8 4.2 0 6.8z"/></g><g transform="rotate(72 12 12)"><path d="M12 10c-1.8-2.6-1.3-5.6 0-6.8 1.3 1.2 1.8 4.2 0 6.8z"/></g><g transform="rotate(144 12 12)"><path d="M12 10c-1.8-2.6-1.3-5.6 0-6.8 1.3 1.2 1.8 4.2 0 6.8z"/></g><g transform="rotate(216 12 12)"><path d="M12 10c-1.8-2.6-1.3-5.6 0-6.8 1.3 1.2 1.8 4.2 0 6.8z"/></g><g transform="rotate(288 12 12)"><path d="M12 10c-1.8-2.6-1.3-5.6 0-6.8 1.3 1.2 1.8 4.2 0 6.8z"/></g><circle cx="12" cy="12" r="1.6"/></g>',
  carp: '<path d="M4 3v18M4 5h11l4 2.5-4 2.5H4M4 12.5h9l4 2.5-4 2.5H4"/><circle cx="14.5" cy="7.5" r=".9" fill="currentColor"/><circle cx="12.5" cy="15" r=".9" fill="currentColor"/>',
  tanabata: '<path d="M4 4c5 1 11 1 16 0M8 4.5v6M12 5v8M16 4.5v5"/><path d="M12 14.5l1.4 2.8 3.1.5-2.2 2.1.5 3.1-2.8-1.5-2.8 1.5.5-3.1-2.2-2.1 3.1-.5z"/>',
  lantern: '<path d="M12 2v2.5M8.5 4.5h7M7.5 6.5c-1.8 3-1.8 9 0 12h9c1.8-3 1.8-9 0-12zM7 10.5h10M7 14.5h10M9.5 18.5v2h5v-2"/>',
  tsukimi: '<path d="M21 9.5A6.5 6.5 0 1 1 14.5 3a5 5 0 0 0 6.5 6.5z"/><circle cx="6" cy="15.5" r="2"/><circle cx="10" cy="15.5" r="2"/><circle cx="8" cy="12" r="2"/><path d="M3 20h10"/>',
  egg: '<path d="M12 3c3.5 0 7 6 7 11a7 7 0 0 1-14 0c0-5 3.5-11 7-11zM5.3 12.5l2.2-1.5 2.2 1.5 2.3-1.5 2.3 1.5 2.2-1.5 2.2 1.5"/>',
  flower: '<circle cx="12" cy="8" r="3"/><path d="M12 11v10M12 17c-3 0-5-2-5-4 2 0 5 1 5 4zM12 15c2.5 0 4.5-1.5 4.5-3.5-2 0-4.5 1-4.5 3.5zM9 8a3 3 0 0 1-3-3M15 8a3 3 0 0 0 3-3"/>',
  firework: '<path d="M12 12V3M12 12l6.4-6.4M12 12h9M12 12l6.4 6.4M12 12v9M12 12l-6.4 6.4M12 12H3M12 12L5.6 5.6"/><circle cx="12" cy="12" r="1.5"/>',
  pumpkin: '<path d="M12 7c-4.5 0-8.5 2.5-8.5 7s4 7 8.5 7 8.5-2.5 8.5-7-4-7-8.5-7zM8.2 7.7c-1.6 2.5-1.6 10.1 0 12.6M15.8 7.7c1.6 2.5 1.6 10.1 0 12.6M12 7c0-2 1-3.5 3-4"/>',
  pie: '<path d="M2.5 14h19l-1.6 5.5H4.1zM3 14a9 7 0 0 1 18 0M8 10l1.2 2M12 9v2.3M16 10l-1.2 2"/>',
  tree: '<path d="M12 2.5l5 6h-3l4 5h-3l4 5H5l4-5H6l4-5H7zM12 18.5V22"/>',
  leaf: '<path d="M5 19C5 10 10 4 20 4c0 10-6 15-15 15zM5 19l8-8"/>',
  snow: '<path d="M12 2.5v19M3.8 7.2l16.4 9.6M20.2 7.2L3.8 16.8M9.5 4l2.5 1.7L14.5 4M9.5 20l2.5-1.7 2.5 1.7"/>',
};

const ALL = { ...HAVEN, ...GLYPHS, ...CHORES, ...SCHEDULE, ...EVENTS };

/** An icon's inner SVG, for callers that draw their own <svg> (the countdown tile). */
export const glyph = (name) => ALL[name] ?? GLYPHS.chores;

export function icon(name, size = 24, stroke = 1.75) {
  const body = ALL[name] ?? GLYPHS.chores;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export const star = (size) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" role="img" aria-label="All done"><path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8 6.6 19.7l1.1-6.1-4.5-4.2 6.1-.8z"/></svg>`;

/** Weather condition → [icon, colour token]. */
export function weatherIcon(cond) {
  switch (cond) {
    case 'sun': return ['sun', 'var(--warm)'];
    case 'cloud': return ['cloud', 'var(--ink-muted)'];
    case 'rain': return ['drop', 'var(--cool)'];
    case 'clear-night': return ['moon', 'var(--ink-muted)'];
    default: return ['cloud', 'var(--ink-muted)'];
  }
}
