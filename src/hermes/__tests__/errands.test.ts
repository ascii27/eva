import { describe, expect, it } from '@jest/globals';
import {
  actionFailureLine,
  actionRequest,
  anchor,
  canAccept,
  deliveryLine,
  doneLine,
  errandRequest,
  failureLine,
  MAX_QUEUED,
  MAX_RUNNING,
  nextToRun,
  readbackLine,
  unfinishedLine,
  type Errand,
} from '../errands';

const errand = (id: string, state: Errand['state']): Errand => ({
  id,
  question: 'is the offsite confirmed',
  kind: 'question',
  needsLookup: true,
  startedAt: 0,
  state,
});

describe('errandRequest', () => {
  it('carries the question', () => {
    expect(errandRequest('is the offsite confirmed', true)).toContain('is the offsite confirmed');
  });

  it('lets hermes reach for tools when Eva said it needs a lookup', () => {
    expect(errandRequest('q', true)).toMatch(/use whatever tools/i);
    expect(errandRequest('q', true)).not.toMatch(/do not use tools/i);
  });

  it('tells hermes to stay out of its tools otherwise', () => {
    // The difference between a few seconds and the 88.7s a full agent run cost
    // on the gateway, which is why this is Eva's call per question.
    expect(errandRequest('q', false)).toMatch(/do not use tools/i);
  });

  it('always asks for brevity and low reasoning', () => {
    for (const needsLookup of [true, false]) {
      const req = errandRequest('q', needsLookup);
      expect(req).toMatch(/reasoning brief/i);
      expect(req).toMatch(/two or three sentences/i);
      expect(req).toMatch(/no markdown/i);
    }
  });

  it('warns that the answer is spoken in a room', () => {
    expect(errandRequest('q', true)).toMatch(/read out loud/i);
  });
});

describe('deliveryLine', () => {
  it('re-anchors to the question, because the conversation has moved on', () => {
    const line = deliveryLine('Is the offsite confirmed?', 'Yes — Thursday, all day.');
    expect(line).toContain('is the offsite confirmed');
    expect(line).toContain('Yes — Thursday, all day.');
  });

  it('drops the question mark and lowers only the leading capital', () => {
    // Only the first letter, so a name in the middle keeps its case.
    expect(deliveryLine('Did Ana reply?', 'She did.')).toContain('did Ana reply');
    expect(deliveryLine('Did Ana reply?', 'She did.')).not.toContain('?');
  });

  it('leaves an acronym alone rather than lower-casing it', () => {
    expect(deliveryLine('MG5 status?', 'Still open.')).toContain('MG5 status');
  });
});

describe('anchor', () => {
  it('trims a long question so the answer is not buried behind it', () => {
    const long = 'whether the platform review that got moved last week is still going ahead on Thursday afternoon or not';
    expect(anchor(long).split(/\s+/)).toHaveLength(12); // the ellipsis rides the 12th word
    expect(anchor(long)).toMatch(/…$/);
  });

  it('leaves a short question whole', () => {
    expect(anchor('is the offsite confirmed?')).toBe('is the offsite confirmed');
  });
});

describe('failureLine', () => {
  it('names what failed and offers to retry', () => {
    const line = failureLine('Is the offsite confirmed?');
    expect(line).toContain('is the offsite confirmed');
    expect(line).toMatch(/try again/i);
  });
});

describe('canAccept', () => {
  it('accepts while there is room', () => {
    expect(canAccept([])).toBe(true);
    expect(canAccept([errand('a', 'running')])).toBe(true);
  });

  it('declines once running and queued fill up', () => {
    const live = Array.from({ length: MAX_RUNNING + MAX_QUEUED }, (_, i) => errand(String(i), 'queued'));
    expect(canAccept(live)).toBe(false);
  });

  it('does not count finished errands against the cap', () => {
    const done = Array.from({ length: 20 }, (_, i) => errand(String(i), 'done'));
    expect(canAccept([...done, errand('x', 'failed')])).toBe(true);
  });
});

describe('nextToRun', () => {
  it('takes the oldest queued errand', () => {
    expect(nextToRun([errand('a', 'queued'), errand('b', 'queued')])?.id).toBe('a');
  });

  it('waits while the runners are full', () => {
    const running = Array.from({ length: MAX_RUNNING }, (_, i) => errand(`r${i}`, 'running'));
    expect(nextToRun([...running, errand('q', 'queued')])).toBeNull();
  });

  it('returns null when nothing is waiting', () => {
    expect(nextToRun([errand('a', 'done')])).toBeNull();
  });
});

// ── Actions ────────────────────────────────────────────────────────────────

const action = (id: string, state: Errand['state']): Errand => ({
  id,
  question: "Add milk to Michael's todo list",
  kind: 'action',
  needsLookup: true,
  startedAt: 0,
  state,
});

describe('actionRequest', () => {
  it('carries the action', () => {
    expect(actionRequest("Add milk to Michael's todo list")).toContain("Add milk to Michael's todo list");
  });

  it('tells hermes to carry it out, not to answer it', () => {
    const req = actionRequest('a');
    expect(req).toMatch(/instruction to carry out/i);
    expect(req).not.toMatch(/do not use tools/i);
  });

  it('asks for one spoken sentence about what it actually did', () => {
    const req = actionRequest('a');
    expect(req).toMatch(/one sentence/i);
    expect(req).toMatch(/read out loud/i);
    expect(req).toMatch(/no markdown/i);
  });

  it('forbids reporting an intention as though it were done', () => {
    // The failure that would make her untrustworthy: hermes describing what it
    // would have done, Eva reading it out as a completed change.
    expect(actionRequest('a')).toMatch(/would have done/i);
  });

  it('tells hermes not to ask a question back', () => {
    // There is no channel back — the report is spoken once, minutes later.
    expect(actionRequest('a')).toMatch(/not.*ask him a question back/i);
  });
});

describe('doneLine', () => {
  it('anchors the report to what he asked for', () => {
    const line = doneLine("Add milk to Michael's todo list", "That's on your list now.");
    expect(line).toContain('add milk to');
    expect(line).toContain("That's on your list now.");
    expect(line).toMatch(/you asked me to/i);
  });

  it('reads the same way when hermes reports a failure', () => {
    const line = doneLine('Move the three o clock to tomorrow', "I couldn't reach the calendar.");
    expect(line).toContain('move the three o clock to tomorrow');
    expect(line).toContain("I couldn't reach the calendar.");
  });
});

describe('actionFailureLine', () => {
  it('does not claim the action failed — only that she never heard back', () => {
    // The distinction that matters: a question we could not send simply did not
    // happen. An action may well have landed and completed on hermes' side
    // while the answer was lost, and saying otherwise is a lie either way.
    const line = actionFailureLine("Add milk to Michael's todo list");
    expect(line).toContain('add milk to');
    expect(line).toMatch(/don't know|do not know/i);
    expect(line).not.toMatch(/failed|didn't happen|did not happen/i);
  });
});

describe('readbackLine', () => {
  it('asks, rather than announcing', () => {
    const line = readbackLine('Move the three o clock to tomorrow');
    expect(line).toContain('move the three o clock to tomorrow');
    expect(line.trim()).toMatch(/\?$/);
  });

  it('keeps more of the action than a delivery anchor would', () => {
    // Truncating the thing being consented to is its own hazard, so the
    // readback gets a longer leash than `anchor`'s spoken default.
    const long = 'Reschedule the platform review that got moved last week to Thursday afternoon instead of Tuesday';
    expect(readbackLine(long)).toContain('instead of Tuesday');
    expect(anchor(long)).not.toContain('instead of Tuesday');
  });
});

describe('unfinishedLine', () => {
  it('is null when nothing was left in flight', () => {
    expect(unfinishedLine([])).toBeNull();
  });

  it('names the one thing she never heard back on', () => {
    const line = unfinishedLine(["Add milk to Michael's todo list"]);
    expect(line).toContain('add milk to');
    expect(line).toMatch(/never heard back|didn't hear back/i);
  });

  it('counts them rather than reciting a list out loud', () => {
    const line = unfinishedLine(['a thing', 'another thing', 'a third thing']);
    expect(line).toMatch(/three/i);
  });
});

describe('the queue does not care which kind it is carrying', () => {
  it('counts actions and questions against the same cap', () => {
    const live = Array.from({ length: MAX_RUNNING + MAX_QUEUED }, (_, i) =>
      i % 2 ? action(String(i), 'queued') : errand(String(i), 'queued'),
    );
    expect(canAccept(live)).toBe(false);
  });

  it('runs whichever is oldest', () => {
    expect(nextToRun([action('a', 'queued'), errand('b', 'queued')])?.id).toBe('a');
  });
});
