// The outbox: actions Eva has sent hermes and not yet heard back on.
//
// Questions are not journalled — a lost question costs nothing, you ask again.
// An action is different in one specific way: by the time the app dies the
// request may already have reached hermes and changed something, so the record
// that matters is not "what did we mean to do" but "what did we say and never
// hear the end of". That is the only question this file answers.
//
// It deliberately does NOT replay. Re-sending across a relaunch needs
// de-duplication, de-duplication needs an idempotency key hermes does not
// promise to honour, and a task added twice is worse than one Eva mentions
// having lost track of. hermes stays the single record of truth; the device
// keeps only enough to admit what it doesn't know.
//
// A file's existence IS the pending state — written on dispatch, deleted on
// settle — so there is no state field to get out of step with the queue, and
// `takeUnfinished` deletes what it returns: a record survives exactly one
// bring-up, which is what stops her reporting the same lost action at every
// launch forever.
//
// Storage mirrors src/agent/store.ts exactly: expo-file-system under the app's
// document directory, and every function swallows its errors. A device that
// cannot read its own outbox should say nothing, never crash the face.

import { Directory, File, Paths } from 'expo-file-system';

const ROOT = 'eva';
const OUTBOX = 'outbox';

/** One action, in flight as far as this device ever knew. */
export interface OutboxEntry {
  id: string;
  /** The instruction as Eva wrote it, for `unfinishedLine` to anchor to. */
  action: string;
  sentAt: number;
}

function outboxDir(): Directory {
  return new Directory(Paths.document, ROOT, OUTBOX);
}

function entryFile(id: string): File {
  return new File(Paths.document, ROOT, OUTBOX, `${id}.json`);
}

/**
 * Note that an action has gone out. Called on dispatch rather than on
 * completion — the whole value is in the window where we do not know.
 */
export async function record(entry: OutboxEntry): Promise<void> {
  try {
    outboxDir().create({ intermediates: true, idempotent: true });
    entryFile(entry.id).write(JSON.stringify(entry));
  } catch {
    // A lost record costs a report she would have made at next launch, which
    // is worth strictly less than the round she is in the middle of.
  }
}

/**
 * Heard back, whichever way it went. Eva has said something about it out loud
 * by now, so there is nothing left for a future launch to report.
 */
export async function settle(id: string): Promise<void> {
  try {
    const file = entryFile(id);
    if (file.exists) file.delete();
  } catch {
    // ignore
  }
}

/**
 * Everything a previous process left in flight, oldest first — and clear it.
 *
 * Returning and deleting in one step is deliberate: these are reported out loud
 * once at bring-up, and a version that only read them would have Eva raising
 * the same lost action at every launch until someone wiped the device.
 */
export async function takeUnfinished(): Promise<OutboxEntry[]> {
  try {
    const dir = outboxDir();
    if (!dir.exists) return [];
    const entries: OutboxEntry[] = [];
    for (const file of dir.list()) {
      if (!(file instanceof File) || !file.name.endsWith('.json')) continue;
      try {
        const parsed = JSON.parse(await file.text());
        if (parsed && typeof parsed.id === 'string' && typeof parsed.action === 'string') {
          entries.push({
            id: parsed.id,
            action: parsed.action,
            sentAt: typeof parsed.sentAt === 'number' ? parsed.sentAt : 0,
          });
        }
      } catch {
        // Skip one unreadable record rather than losing the rest.
      }
      try {
        file.delete();
      } catch {
        // ignore
      }
    }
    return entries.sort((a, b) => a.sentAt - b.sentAt);
  } catch {
    return [];
  }
}
