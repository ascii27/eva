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

const ALL = { ...HAVEN, ...GLYPHS, ...CHORES };

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
