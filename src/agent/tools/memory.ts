// Searching Eva's archived conversations.
//
// `recentMemories(MEMORY_LIMIT)` already puts the five most recent session
// summaries in the prompt, so this tool exists for everything older than that.
//
// Ranking is keyword overlap, deliberately: the corpus is a few dozen short
// summaries on one phone, and embeddings would mean a second model download
// and a native rebuild to answer a question a substring match answers. The
// scoring is pure and tested here; only `runMemorySearch` touches the disk.

import { allMemories, type MemoryEntry } from '../store';
import { MEMORY_RESULTS } from './specs';

/** What the ranking needs. Same shape the store hands back. */
export type MemoryRecord = MemoryEntry;

/**
 * Words too common to carry a signal. Speech makes this matter more than it
 * would for typed search — a spoken question arrives as "what did we say about
 * the roadmap", and without this every record matches on "the".
 */
const STOPWORDS = new Set([
  'a', 'about', 'all', 'and', 'any', 'anything', 'are', 'as', 'at', 'back', 'be', 'been', 'but', 'by',
  'can', 'did', 'do', 'does', 'for', 'from', 'get', 'had', 'has', 'have', 'he', 'her', 'him', 'his',
  'how', 'i', 'if', 'in', 'is', 'it', 'its', 'just', 'me', 'my', 'of', 'on', 'or', 'our', 'out',
  'remember', 'said', 'say', 'she', 'so', 'talk', 'talked', 'that', 'the', 'their', 'them', 'then',
  'there', 'they', 'this', 'to', 'told', 'up', 'us', 'was', 'we', 'were', 'what', 'when', 'where',
  'which', 'who', 'why', 'with', 'you', 'your',
]);

/** Query text to the distinct terms worth scoring. */
function terms(query: string): string[] {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  return [...new Set(words)];
}

/**
 * The `limit` best-matching records, most relevant first. Scored on how many
 * *distinct* query terms appear — breadth of match, not frequency, so a summary
 * repeating one word cannot outrank one covering the whole question. Ties go to
 * the more recent conversation, and a record matching nothing is dropped rather
 * than returned with a zero.
 */
export function searchMemories(records: MemoryRecord[], query: string, limit: number): MemoryRecord[] {
  const wanted = terms(query);
  if (wanted.length === 0) return [];

  return records
    .map((record) => {
      const haystack = record.summary.toLowerCase();
      return { record, score: wanted.filter((term) => haystack.includes(term)).length };
    })
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score || b.record.endedAt - a.record.endedAt)
    .slice(0, limit)
    .map((scored) => scored.record);
}

/** Read the archive and search it. The only part of this file that does I/O. */
export async function runMemorySearch(query: string): Promise<string> {
  const records = await allMemories();
  const hits = searchMemories(records, query, MEMORY_RESULTS);
  if (hits.length === 0) return 'No earlier conversation mentions that.';
  return hits.map((h) => `[${new Date(h.endedAt).toDateString()}] ${h.summary}`).join('\n\n');
}
