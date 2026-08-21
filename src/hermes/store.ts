// The last good bundle, on disk.
//
// Sits alongside src/agent/store.ts and follows it: expo-file-system rather
// than AsyncStorage, under the same `eva/` root. It exists for one moment — the
// first seconds after a relaunch, before any refresh has returned — so that Eva
// comes back with a picture of the day rather than blind. Correctly marked as
// however old it is, which the volatile block handles for free.
//
// What is written is the RAW response text, not the parsed bundle. That keeps
// `parseBundle` the single validator in the system: there is no second reader
// that could disagree with it about what a bundle is, and no disk format that
// can drift from the wire format. It also means a bundle that failed to parse
// could be kept here for inspection later, if that ever proves worth doing.
//
// `src/agent/store.ts`'s clearAll() deletes the whole `eva/` directory, so
// "forget everything" takes this with it. That is harmless: the bundle is a
// cache of someone else's state, not a memory, and the next refresh rebuilds it.
// Only a relaunch in the gap between the two would start blind.

import { Directory, File, Paths } from 'expo-file-system';
import { budgetCore, parseBundle, type Bundle } from './bundle';

const ROOT = 'eva';
const BUNDLE_FILE = 'bundle.json';

function bundleFile(): File {
  return new File(Paths.document, ROOT, BUNDLE_FILE);
}

/**
 * The stored bundle, already trimmed to budget, or null when there isn't one.
 * Re-parsed through the same path a live response takes, so a stored bundle can
 * never be something a live one could not have been.
 */
export async function loadBundle(): Promise<Bundle | null> {
  try {
    const file = bundleFile();
    if (!file.exists) return null;
    const parsed = JSON.parse(await file.text());
    if (!parsed || typeof parsed.raw !== 'string') return null;
    const bundle = parseBundle(parsed.raw);
    return bundle ? budgetCore(bundle) : null;
  } catch {
    return null;
  }
}

export async function saveBundle(raw: string): Promise<void> {
  try {
    new Directory(Paths.document, ROOT).create({ intermediates: true, idempotent: true });
    bundleFile().write(JSON.stringify({ raw }));
  } catch {
    // A lost bundle costs one relaunch's worth of blindness, never a crash.
  }
}
