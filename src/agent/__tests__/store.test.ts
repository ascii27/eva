import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// An in-memory stand-in for expo-file-system's File/Directory/Paths API. Kept
// inside the factory so nothing is referenced before it is initialised; the
// `__fake` handle is how tests reset and inspect it.
jest.mock('expo-file-system', () => {
  const files = new Map<string, string>();
  const dirs = new Set<string>();

  const join = (parts: unknown[]): string =>
    parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/');
  const parentOf = (uri: string) => uri.slice(0, uri.lastIndexOf('/'));

  class MockFile {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get name(): string {
      return this.uri.slice(this.uri.lastIndexOf('/') + 1);
    }
    get exists(): boolean {
      return files.has(this.uri);
    }
    async text(): Promise<string> {
      const value = files.get(this.uri);
      if (value === undefined) throw new Error(`ENOENT ${this.uri}`);
      return value;
    }
    write(content: string): void {
      // Mirrors the real API: writing into a missing folder throws.
      if (!dirs.has(parentOf(this.uri))) throw new Error(`ENOENT parent of ${this.uri}`);
      files.set(this.uri, content);
    }
    delete(): void {
      files.delete(this.uri);
    }
  }

  class MockDirectory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get name(): string {
      return this.uri.slice(this.uri.lastIndexOf('/') + 1);
    }
    get exists(): boolean {
      return dirs.has(this.uri);
    }
    create(options?: { intermediates?: boolean; idempotent?: boolean }): void {
      if (dirs.has(this.uri) && !options?.idempotent) throw new Error(`EEXIST ${this.uri}`);
      if (!options?.intermediates && !dirs.has(parentOf(this.uri)) && parentOf(this.uri)) {
        throw new Error(`ENOENT parent of ${this.uri}`);
      }
      dirs.add(this.uri);
    }
    /** Direct children only. */
    list(): MockFile[] {
      const prefix = `${this.uri}/`;
      return [...files.keys()]
        .filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
        .map((k) => new MockFile(k));
    }
    delete(): void {
      const prefix = `${this.uri}/`;
      for (const k of [...files.keys()]) if (k.startsWith(prefix)) files.delete(k);
      for (const d of [...dirs]) if (d === this.uri || d.startsWith(prefix)) dirs.delete(d);
    }
  }

  const document = new MockDirectory('file:///doc');
  dirs.add(document.uri);

  return {
    File: MockFile,
    Directory: MockDirectory,
    Paths: { document },
    __fake: {
      files,
      dirs,
      reset: () => {
        files.clear();
        dirs.clear();
        dirs.add(document.uri);
      },
    },
  };
});

import * as FileSystem from 'expo-file-system';
import { newSession, type Session } from '../history';
import { archiveSession, clearAll, loadSession, recentMemories, saveSession } from '../store';

const fake = (FileSystem as unknown as { __fake: { files: Map<string, string>; reset: () => void } }).__fake;

const SESSION_URI = 'file:///doc/eva/session.json';
const NOW = Date.UTC(2026, 7, 15, 14, 22, 1);

function withTurns(startedAt: number, texts: string[]): Session {
  const base = newSession(startedAt);
  return { ...base, turns: texts.map((t, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: t })) };
}

beforeEach(() => {
  fake.reset();
});

describe('loadSession', () => {
  it('is null on a virgin device', async () => {
    expect(await loadSession()).toBeNull();
  });

  it('round-trips a saved session', async () => {
    const s = withTurns(NOW, ['what time is it', 'just past two']);
    await saveSession(s);
    expect(await loadSession()).toEqual(s);
  });

  it('is null rather than throwing on unparseable json', async () => {
    await saveSession(newSession(NOW)); // creates the directories
    fake.files.set(SESSION_URI, '{ this is not json');
    expect(await loadSession()).toBeNull();
  });

  it('is null when the json parses but is not a session', async () => {
    await saveSession(newSession(NOW));
    fake.files.set(SESSION_URI, JSON.stringify({ nope: true }));
    expect(await loadSession()).toBeNull();
  });

  it('normalises a missing summary to null', async () => {
    await saveSession(newSession(NOW));
    fake.files.set(SESSION_URI, JSON.stringify({ id: 'x', startedAt: 1, lastAt: 2, turns: [] }));
    expect((await loadSession())?.summary).toBeNull();
  });
});

describe('saveSession', () => {
  it('creates its directories on first write', async () => {
    await saveSession(newSession(NOW));
    expect(fake.files.has(SESSION_URI)).toBe(true);
  });

  it('overwrites the previous session rather than accumulating files', async () => {
    await saveSession(withTurns(NOW, ['first']));
    await saveSession(withTurns(NOW, ['second']));
    expect([...fake.files.keys()].filter((k) => k.endsWith('session.json'))).toHaveLength(1);
    expect((await loadSession())?.turns[0].content).toBe('second');
  });
});

describe('archiveSession', () => {
  it('writes the summary to memory and clears the live session', async () => {
    const s = withTurns(NOW, ['hello', 'hi there']);
    await saveSession(s);
    await archiveSession(s, 'they said hello', NOW + 1000);

    expect(fake.files.has(SESSION_URI)).toBe(false);
    expect(await recentMemories(5)).toEqual(['they said hello']);
  });

  it('keeps the raw turns alongside the summary for later passes', async () => {
    const s = withTurns(NOW, ['hello', 'hi there']);
    await archiveSession(s, 'they said hello', NOW + 1000);
    const [uri] = [...fake.files.keys()].filter((k) => k.includes('/memory/'));
    expect(JSON.parse(fake.files.get(uri)!)).toMatchObject({
      id: s.id,
      startedAt: NOW,
      endedAt: NOW + 1000,
      summary: 'they said hello',
      turns: s.turns,
    });
  });

  it('clears the live session but writes no memory when there is nothing to remember', async () => {
    const s = withTurns(NOW, ['what time is it', 'just past two']);
    await saveSession(s);
    await archiveSession(s, null, NOW + 1000);

    expect(fake.files.has(SESSION_URI)).toBe(false);
    expect(await recentMemories(5)).toEqual([]);
  });

  it('names the file after the session id, so listing is chronological', async () => {
    const s = withTurns(NOW, ['hello']);
    await archiveSession(s, 'a summary', NOW + 1);
    expect([...fake.files.keys()]).toContain(`file:///doc/eva/memory/${s.id}.json`);
  });
});

describe('recentMemories', () => {
  const hoursApart = (n: number) => NOW + n * 3_600_000;

  async function archiveMany(count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      const at = hoursApart(i);
      await archiveSession(withTurns(at, ['x']), `summary ${i}`, at + 60_000);
    }
  }

  it('is empty on a virgin device', async () => {
    expect(await recentMemories(5)).toEqual([]);
  });

  it('returns the most recent summaries, oldest first', async () => {
    await archiveMany(3);
    expect(await recentMemories(5)).toEqual(['summary 0', 'summary 1', 'summary 2']);
  });

  it('keeps the newest when there are more than the limit', async () => {
    await archiveMany(8);
    expect(await recentMemories(3)).toEqual(['summary 5', 'summary 6', 'summary 7']);
  });

  it('skips one unreadable record rather than losing the whole block', async () => {
    await archiveMany(3);
    const [middle] = [...fake.files.keys()].filter((k) => k.includes('/memory/')).sort().slice(1);
    fake.files.set(middle, 'not json at all');
    expect(await recentMemories(5)).toEqual(['summary 0', 'summary 2']);
  });

  it('ignores archives whose summary is missing or empty', async () => {
    await archiveMany(2);
    const [first] = [...fake.files.keys()].filter((k) => k.includes('/memory/')).sort();
    fake.files.set(first, JSON.stringify({ id: 'x', summary: '' }));
    expect(await recentMemories(5)).toEqual(['summary 1']);
  });
});

describe('clearAll', () => {
  it('removes the session and every memory', async () => {
    await saveSession(withTurns(NOW, ['hello']));
    await archiveSession(withTurns(NOW, ['hello']), 'a summary', NOW + 1);
    await clearAll();

    expect(await loadSession()).toBeNull();
    expect(await recentMemories(5)).toEqual([]);
  });

  it('leaves the store usable afterwards', async () => {
    await clearAll();
    await saveSession(withTurns(NOW, ['fresh start']));
    expect((await loadSession())?.turns[0].content).toBe('fresh start');
  });
});
