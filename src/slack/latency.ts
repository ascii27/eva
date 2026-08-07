// Round latency formatting for the PRD exit criterion — no React, unit-tested.

import type { RoundMarks } from './protocol';

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function formatLatency(marks: RoundMarks): string {
  const parts = ['latency'];
  if (marks.postedAt !== undefined) parts.push(`post ${secs(marks.postedAt - marks.heardAt)}`);
  if (marks.postedAt !== undefined && marks.replyAt !== undefined) {
    parts.push(`eva ${secs(marks.replyAt - marks.postedAt)}`);
    if (marks.spokeAt !== undefined) {
      parts.push(`total ${secs(marks.spokeAt - (marks.wokeAt ?? marks.heardAt))}`);
    }
  } else {
    parts.push('no reply');
  }
  return parts.join(' · ');
}
