import { describe, expect, it } from '@jest/globals';
import type { MessageEvent } from '../../slack/protocol';
import {
  ADOPTION_IDLE_MS,
  ADOPTION_MAX,
  announceable,
  dequeue,
  dropTs,
  enqueue,
  mentionsBot,
  PROACTIVE_QUEUE_MAX,
  receive,
  threadRoot,
  type Adoptions,
  type ProactiveItem,
} from '../proactive';

const NOW = 1_754_600_000_000;
const BOT = 'U0BOTCOMPANION';
const EVA = 'U0B7PD9CWSX';
const CHANNEL = 'C0B7ZEBTVK6';

function msg(over: Partial<MessageEvent> & { ts: string }): MessageEvent {
  return { channel: CHANNEL, user: EVA, ...over };
}

function item(over: Partial<ProactiveItem> = {}): ProactiveItem {
  return { ts: '1.0', threadTs: '1.0', text: 'hello', at: NOW, ...over };
}

describe('threadRoot', () => {
  it('is the message itself for a root message', () => {
    expect(threadRoot(msg({ ts: '100.1' }))).toBe('100.1');
  });

  it('is the parent for a threaded reply', () => {
    expect(threadRoot(msg({ ts: '200.2', thread_ts: '100.1' }))).toBe('100.1');
  });
});

describe('mentionsBot', () => {
  it('matches the bare mention token', () => {
    expect(mentionsBot(`<@${BOT}> the deck finished`, BOT)).toBe(true);
  });

  it('matches the labelled form', () => {
    expect(mentionsBot(`<@${BOT}|eva-companion> hi`, BOT)).toBe(true);
  });

  it('ignores a mention of someone else', () => {
    expect(mentionsBot(`<@${EVA}> hi`, BOT)).toBe(false);
  });

  it('ignores the bare id in prose', () => {
    expect(mentionsBot(`the bot is ${BOT}`, BOT)).toBe(false);
  });
});

describe('announceable', () => {
  it('flattens mrkdwn and strips the mention', () => {
    expect(announceable(`<@${BOT}> the *deck* finished rendering`)).toBe('the deck finished rendering');
  });

  it('rejects tool echoes', () => {
    expect(announceable(':computer: terminal `npm run build`')).toBeNull();
  });

  it('rejects a message that sanitizes to nothing', () => {
    expect(announceable(`<@${BOT}>`)).toBeNull();
  });
});

describe('receive', () => {
  it('adopts the thread on an @-mention and yields the line', () => {
    const r = receive(msg({ ts: '100.1', text: `<@${BOT}> the deck finished` }), NOW, BOT, {});
    expect(r.adoptions).toEqual({ '100.1': NOW });
    expect(r.item).toEqual({ ts: '100.1', threadTs: '100.1', text: 'the deck finished', at: NOW });
  });

  it('adopts by mentioning inside an existing thread, keyed on the root', () => {
    const r = receive(msg({ ts: '200.2', thread_ts: '100.1', text: `<@${BOT}> heads up` }), NOW, BOT, {});
    expect(r.adoptions).toEqual({ '100.1': NOW });
    expect(r.item?.threadTs).toBe('100.1');
  });

  it('speaks a later message in an adopted thread with no mention', () => {
    const adopted: Adoptions = { '100.1': NOW };
    const r = receive(msg({ ts: '300.3', thread_ts: '100.1', text: 'appendix still rendering' }), NOW + 5_000, BOT, adopted);
    expect(r.item?.text).toBe('appendix still rendering');
    expect(r.adoptions['100.1']).toBe(NOW + 5_000);
  });

  it('stays silent for an unmentioned message in an unknown thread', () => {
    const r = receive(msg({ ts: '400.4', text: 'unrelated channel chatter' }), NOW, BOT, {});
    expect(r.item).toBeNull();
    expect(r.adoptions).toEqual({});
  });

  it('refreshes an adopted thread on a tool echo without speaking it', () => {
    const r = receive(
      msg({ ts: '300.3', thread_ts: '100.1', text: ':computer: terminal `ls`' }),
      NOW + 5_000,
      BOT,
      { '100.1': NOW },
    );
    expect(r.item).toBeNull();
    expect(r.adoptions['100.1']).toBe(NOW + 5_000);
  });

  it('drops an adoption once the thread has been silent past the deadline', () => {
    const r = receive(
      msg({ ts: '300.3', thread_ts: '100.1', text: 'too late' }),
      NOW + ADOPTION_IDLE_MS,
      BOT,
      { '100.1': NOW },
    );
    expect(r.item).toBeNull();
    expect(r.adoptions).toEqual({});
  });

  it('keeps an adoption alive right up to the deadline', () => {
    const r = receive(
      msg({ ts: '300.3', thread_ts: '100.1', text: 'just in time' }),
      NOW + ADOPTION_IDLE_MS - 1,
      BOT,
      { '100.1': NOW },
    );
    expect(r.item?.text).toBe('just in time');
  });

  it('re-adopts an expired thread when Eva mentions us again', () => {
    const r = receive(
      msg({ ts: '300.3', thread_ts: '100.1', text: `<@${BOT}> back again` }),
      NOW + ADOPTION_IDLE_MS * 2,
      BOT,
      { '100.1': NOW },
    );
    expect(r.item?.text).toBe('back again');
    expect(r.adoptions['100.1']).toBe(NOW + ADOPTION_IDLE_MS * 2);
  });

  it('prunes unrelated expired threads while handling a live one', () => {
    const r = receive(msg({ ts: '300.3', thread_ts: '100.1', text: 'still here' }), NOW + 1_000, BOT, {
      '100.1': NOW,
      '999.9': NOW - ADOPTION_IDLE_MS,
    });
    expect(Object.keys(r.adoptions)).toEqual(['100.1']);
  });

  it('caps tracked threads, keeping the most recent', () => {
    const adoptions: Adoptions = {};
    for (let i = 0; i < ADOPTION_MAX; i++) adoptions[`old${i}`] = NOW + i;
    const r = receive(msg({ ts: '900.9', text: `<@${BOT}> newest` }), NOW + 1_000, BOT, adoptions);
    const roots = Object.keys(r.adoptions);
    expect(roots).toHaveLength(ADOPTION_MAX);
    expect(roots).toContain('900.9');
    expect(roots).not.toContain('old0');
  });
});

describe('enqueue', () => {
  it('appends without dropping below the cap', () => {
    const r = enqueue([item({ ts: 'a' })], item({ ts: 'b' }));
    expect(r.queue.map((i) => i.ts)).toEqual(['a', 'b']);
    expect(r.dropped).toBeNull();
  });

  it('drops the oldest at the cap and reports it', () => {
    let queue: ProactiveItem[] = [];
    for (let i = 0; i < PROACTIVE_QUEUE_MAX; i++) queue = enqueue(queue, item({ ts: `t${i}` })).queue;
    const r = enqueue(queue, item({ ts: 'overflow' }));
    expect(r.queue).toHaveLength(PROACTIVE_QUEUE_MAX);
    expect(r.dropped?.ts).toBe('t0');
    expect(r.queue.map((i) => i.ts)).toContain('overflow');
  });
});

describe('dequeue', () => {
  it('takes the oldest first', () => {
    const r = dequeue([item({ ts: 'a' }), item({ ts: 'b' })]);
    expect(r.item?.ts).toBe('a');
    expect(r.queue.map((i) => i.ts)).toEqual(['b']);
  });

  it('reports nothing for an empty queue', () => {
    expect(dequeue([])).toEqual({ item: null, queue: [] });
  });
});

describe('dropTs', () => {
  it('removes a message that turned out to settle an ask', () => {
    expect(dropTs([item({ ts: 'a' }), item({ ts: 'b' })], 'a').map((i) => i.ts)).toEqual(['b']);
  });

  it('leaves the queue alone when the ts is absent', () => {
    expect(dropTs([item({ ts: 'a' })], 'zz')).toHaveLength(1);
  });
});
