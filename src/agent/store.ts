// Session and memory persistence, on the filesystem rather than in
// AsyncStorage.
//
// The rest of the app persists small scalars under `eva.*.vN` AsyncStorage keys,
// and this deliberately departs from that: memory is a growing set of discrete
// records, and one file per archived session is the unit a later exe.dev sync
// would push. expo-file-system is already a declared dependency (ExecuTorch
// pulls it in for model downloads), so this needs no EAS rebuild.
//
// Layout, under the app's document directory:
//
//   eva/
//     session.json                       the live session
//     memory/2026-08-15T14-22-01.json    one archived session per file
//
// Filenames come from history.sessionId(), which is second-resolution ISO with
// filesystem-safe separators — so listing the directory and sorting by name
// yields chronological order without reading any file.
//
// Every function swallows its errors. A device that cannot read its own history
// should start a fresh conversation, never crash the face.

import { Directory, File, Paths } from 'expo-file-system';
import type { Session } from './history';

const ROOT = 'eva';
const MEMORY = 'memory';
const SESSION_FILE = 'session.json';

/** An archived session. Turns are kept alongside the summary so a future pass
 *  (better summaries, embeddings, a sync to exe.dev) still has the source. */
export interface ArchivedSession {
  id: string;
  startedAt: number;
  endedAt: number;
  summary: string;
  turns: Session['turns'];
}

function rootDir(): Directory {
  return new Directory(Paths.document, ROOT);
}

function memoryDir(): Directory {
  return new Directory(Paths.document, ROOT, MEMORY);
}

/** Both directories, created if missing. Safe to call on every write. */
function ensureDirs(): void {
  rootDir().create({ intermediates: true, idempotent: true });
  memoryDir().create({ intermediates: true, idempotent: true });
}

function sessionFile(): File {
  return new File(Paths.document, ROOT, SESSION_FILE);
}

function isSession(value: unknown): value is Session {
  if (!value || typeof value !== 'object') return false;
  const s = value as Partial<Session>;
  return typeof s.id === 'string' && typeof s.startedAt === 'number' && typeof s.lastAt === 'number' && Array.isArray(s.turns);
}

/** The live session, or null when there isn't one (first run, or unreadable). */
export async function loadSession(): Promise<Session | null> {
  try {
    const file = sessionFile();
    if (!file.exists) return null;
    const parsed = JSON.parse(await file.text());
    if (!isSession(parsed)) return null;
    return { ...parsed, summary: typeof parsed.summary === 'string' ? parsed.summary : null };
  } catch {
    return null;
  }
}

export async function saveSession(session: Session): Promise<void> {
  try {
    ensureDirs();
    sessionFile().write(JSON.stringify(session));
  } catch {
    // A lost session means Eva forgets this conversation, not a crash.
  }
}

/**
 * Close a session out to memory and clear the live slot. A session with nothing
 * worth remembering is still cleared — the summary is simply not written, so it
 * never becomes an empty memory that dilutes the block.
 */
export async function archiveSession(session: Session, summary: string | null, endedAt: number): Promise<void> {
  try {
    ensureDirs();
    if (summary) {
      const record: ArchivedSession = {
        id: session.id,
        startedAt: session.startedAt,
        endedAt,
        summary,
        turns: session.turns,
      };
      new File(Paths.document, ROOT, MEMORY, `${session.id}.json`).write(JSON.stringify(record));
    }
    const live = sessionFile();
    if (live.exists) live.delete();
  } catch {
    // ignore
  }
}

/** The archive files, oldest first. Chronological by construction of the name. */
function memoryFiles(): File[] {
  const dir = memoryDir();
  if (!dir.exists) return [];
  return dir
    .list()
    .filter((entry): entry is File => entry instanceof File && entry.name.endsWith('.json'))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The `limit` most recent session summaries, oldest first — chronological order
 * reads naturally in the prompt, and keeping it stable across turns is what lets
 * the persona block stay byte-identical and cacheable.
 */
export async function recentMemories(limit: number): Promise<string[]> {
  try {
    const summaries: string[] = [];
    for (const file of memoryFiles().slice(-limit)) {
      try {
        const parsed = JSON.parse(await file.text());
        if (parsed && typeof parsed.summary === 'string' && parsed.summary) summaries.push(parsed.summary);
      } catch {
        // Skip one unreadable record rather than losing the whole block.
      }
    }
    return summaries;
  } catch {
    return [];
  }
}

/** What a memory search needs from an archived session: enough to rank it and date it. */
export interface MemoryEntry {
  id: string;
  endedAt: number;
  summary: string;
}

/**
 * Every archived session, oldest first. Unlike `recentMemories` this is not
 * capped: the whole point of the memory tool is to reach conversations older
 * than the handful already carried in the prompt. The corpus is a few dozen
 * short summaries on one phone, so reading all of them is cheap.
 */
export async function allMemories(): Promise<MemoryEntry[]> {
  try {
    const entries: MemoryEntry[] = [];
    for (const file of memoryFiles()) {
      try {
        const parsed = JSON.parse(await file.text());
        if (!parsed || typeof parsed.summary !== 'string' || !parsed.summary) continue;
        entries.push({
          id: typeof parsed.id === 'string' ? parsed.id : file.name.replace(/\.json$/, ''),
          endedAt: typeof parsed.endedAt === 'number' ? parsed.endedAt : 0,
          summary: parsed.summary,
        });
      } catch {
        // Skip one unreadable record rather than losing the whole archive.
      }
    }
    return entries;
  } catch {
    return [];
  }
}

/** Dev affordance: forget everything. */
export async function clearAll(): Promise<void> {
  try {
    const dir = rootDir();
    if (dir.exists) dir.delete();
  } catch {
    // ignore
  }
}
