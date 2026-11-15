// The board's state and every way it can change. Pure: no I/O, no clock —
// callers pass `at`. Kept this way so it is testable with node:test and so the
// server stays a thin shell around it, the same split as src/agent/history.ts.
//
// Two writers, deliberately different:
//   - the family, by touch: toggling a chore. Instant, local, works when hermes
//     is down.
//   - Eva (hermes), by push: replacing the chore list, setting a panel. The
//     board never polls hermes — one pull of the desk bundle was measured at
//     ~325k tokens / 88s, so hermes pushes when it has something new.
//
// Absent vs empty, as on the desk: a panel missing from `panels` means "Eva
// never told us"; a panel present with empty data means "there is nothing".

export interface Chore {
  id: string;
  title: string;
  /** Who it belongs to, or null for anyone. */
  who: string | null;
  /** Icon key the board knows (see web/icons.js); null for the generic check. */
  icon: string | null;
  done: boolean;
  doneAt: number | null;
}

export interface ChoreInput {
  id: string;
  title: string;
  who: string | null;
  icon: string | null;
}

export interface Panel {
  data: unknown;
  updatedAt: number;
}

export interface BoardState {
  /** Bumped on every change, so a client can tell a stale broadcast from a new one. */
  version: number;
  chores: Chore[];
  panels: Record<string, Panel>;
}

export type Action =
  | { type: 'chore.set'; id: string; done: boolean; at: number }
  | { type: 'chores.replace'; chores: ChoreInput[]; at: number }
  | { type: 'panel.set'; name: string; data: unknown; at: number }
  | { type: 'panel.clear'; name: string };

export function emptyState(): BoardState {
  return { version: 0, chores: [], panels: {} };
}

/** Returns the next state, or null when the action changes nothing (unknown id, etc). */
export function apply(s: BoardState, a: Action): BoardState | null {
  switch (a.type) {
    case 'chore.set': {
      // Set, not toggle: the board's undo sends the state it wants back, so a
      // double tap or a retried request can't flip it the wrong way.
      const i = s.chores.findIndex((c) => c.id === a.id);
      if (i < 0) return null;
      const c = s.chores[i];
      if (c.done === a.done) return null;
      const chores = s.chores.slice();
      chores[i] = { ...c, done: a.done, doneAt: a.done ? a.at : null };
      return { ...s, version: s.version + 1, chores };
    }
    case 'chores.replace': {
      // Keep done-ness for chores that survive the replace: Eva re-sending the
      // list must not un-tick what a kid just ticked.
      const prev = new Map(s.chores.map((c) => [c.id, c]));
      const chores = a.chores.map((c) => {
        const old = prev.get(c.id);
        return { ...c, done: old?.done ?? false, doneAt: old?.doneAt ?? null };
      });
      return { ...s, version: s.version + 1, chores };
    }
    case 'panel.set':
      return {
        ...s,
        version: s.version + 1,
        panels: { ...s.panels, [a.name]: { data: a.data, updatedAt: a.at } },
      };
    case 'panel.clear': {
      if (!(a.name in s.panels)) return null;
      const panels = { ...s.panels };
      delete panels[a.name];
      return { ...s, version: s.version + 1, panels };
    }
  }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const PANEL_NAME = /^[a-z][a-z0-9-]{0,31}$/;

/** Validates a pushed chore list. Returns the list, or an error string. */
export function parseChores(body: unknown): ChoreInput[] | string {
  const list = (body as { chores?: unknown } | null)?.chores;
  if (!Array.isArray(list)) return 'expected {"chores": [...]}';
  const seen = new Set<string>();
  const out: ChoreInput[] = [];
  for (const [i, raw] of list.entries()) {
    const c = raw as Record<string, unknown> | null;
    if (!c || typeof c !== 'object') return `chores[${i}]: not an object`;
    if (typeof c.id !== 'string' || !ID.test(c.id)) return `chores[${i}].id: invalid`;
    if (seen.has(c.id)) return `chores[${i}].id: duplicate "${c.id}"`;
    if (typeof c.title !== 'string' || !c.title.trim()) return `chores[${i}].title: required`;
    if (c.who != null && typeof c.who !== 'string') return `chores[${i}].who: must be a string`;
    if (c.icon != null && typeof c.icon !== 'string') return `chores[${i}].icon: must be a string`;
    seen.add(c.id);
    out.push({
      id: c.id,
      title: c.title.trim(),
      who: (c.who as string | undefined) ?? null,
      icon: (c.icon as string | undefined) ?? null,
    });
  }
  return out;
}

/** Parses a saved state file, falling back to empty on anything unexpected. */
export function reviveState(raw: unknown): BoardState {
  const s = raw as Partial<BoardState> | null;
  if (!s || typeof s !== 'object' || !Array.isArray(s.chores) || typeof s.panels !== 'object' || !s.panels) {
    return emptyState();
  }
  // Files written before a field existed get it filled in rather than discarded.
  const chores = s.chores.map((c) => ({ ...c, who: c.who ?? null, icon: c.icon ?? null }));
  return { version: typeof s.version === 'number' ? s.version : 0, chores, panels: s.panels };
}
