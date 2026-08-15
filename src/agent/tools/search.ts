// Web search, via Tavily.
//
// Tavily over a general search API because it returns a synthesized answer
// alongside its results: Eva has to say the answer in a sentence or two, and
// summarizing a page of blue links herself would cost an extra lap's worth of
// tokens on every search.
//
// The formatter is pure and tested; only `runSearch` touches the network. What
// it strips matters — URLs are unlistenable, and a full-length snippet read
// aloud is an essay — so the digest is shaped for the ear before the model
// ever sees it.

const ENDPOINT = 'https://api.tavily.com/search';

/** How much of one result to keep. Enough to answer from, short enough to say. */
export const SNIPPET_CHARS = 300;

/** Results past this are noise the model would have to wade through. */
const MAX_SNIPPETS = 3;

export interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}

export interface TavilyResponse {
  answer?: string;
  results?: TavilyResult[];
}

const NOTHING = 'The search came back with nothing useful.';

function snippet(result: TavilyResult): string | null {
  const content = (result.content ?? '').trim();
  if (!content) return null;
  const body = content.length > SNIPPET_CHARS ? `${content.slice(0, SNIPPET_CHARS).trimEnd()}…` : content;
  const title = (result.title ?? '').trim();
  return title ? `${title}: ${body}` : body;
}

/**
 * A Tavily response as a short digest for the model to answer from. The
 * synthesized answer leads, because it is usually the whole reply; the
 * snippets behind it are there for when it is thin or wrong.
 */
export function formatResults(raw: TavilyResponse): string {
  const answer = (raw.answer ?? '').trim();
  const snippets = (raw.results ?? [])
    .map(snippet)
    .filter((s): s is string => s !== null)
    .slice(0, MAX_SNIPPETS);

  if (!answer && snippets.length === 0) return NOTHING;
  if (!answer) return snippets.join('\n\n');
  if (snippets.length === 0) return answer;
  return `${answer}\n\n${snippets.join('\n\n')}`;
}

/**
 * Run one search. Network failures come back as a sentence rather than a
 * throw: the model should be able to say it couldn't reach the web, which is
 * a better round than one that dies.
 */
export async function runSearch(apiKey: string, query: string, signal?: AbortSignal): Promise<string> {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal,
      body: JSON.stringify({
        query,
        include_answer: true,
        // 'basic' rather than 'advanced': a spoken answer does not need deep
        // crawling, and the extra seconds land inside a round someone is
        // waiting through.
        search_depth: 'basic',
        max_results: MAX_SNIPPETS + 2,
      }),
    });
    if (!res.ok) return `The search failed (http ${res.status}).`;
    const data = (await res.json()) as TavilyResponse;
    return formatResults(data);
  } catch (e) {
    return `The search could not be reached: ${e instanceof Error ? e.message : String(e)}`;
  }
}
