import { describe, expect, it } from '@jest/globals';
import {
  anchor,
  canAccept,
  deliveryLine,
  errandRequest,
  failureLine,
  MAX_QUEUED,
  MAX_RUNNING,
  nextToRun,
  type Errand,
} from '../errands';

const errand = (id: string, state: Errand['state']): Errand => ({
  id,
  question: 'is the offsite confirmed',
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
