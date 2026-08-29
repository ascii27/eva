import { describe, expect, it, jest } from '@jest/globals';
import type { Photo } from '../../../vision/photos';
import { buildToolKit, type ErrandHandles, type ToolConfig, type VisionHandles } from '../index';

/** Both handles, so a test can override only the one it is about. */
const stubErrands = (over: Partial<ErrandHandles> = {}): ErrandHandles => ({
  start: () => 'e1',
  send: () => 'a1',
  ...over,
});

const WITH_SEARCH: ToolConfig = { tavilyKey: 'tvly-test', vision: null, errands: null };
const WITHOUT_SEARCH: ToolConfig = { tavilyKey: null, vision: null, errands: null };

const names = (cfg: ToolConfig) => buildToolKit(cfg).specs.map((s) => s.name);

describe('buildToolKit specs', () => {
  it('always offers the local tools', () => {
    expect(names(WITHOUT_SEARCH)).toEqual(expect.arrayContaining(['clock', 'memory_search']));
  });

  it('offers web_search when a key is configured', () => {
    expect(names(WITH_SEARCH)).toContain('web_search');
  });

  it('omits web_search entirely when there is no key', () => {
    // Offering a tool she cannot run means Eva promises a search and then
    // apologizes; better that she knows she has no way to look things up.
    expect(names(WITHOUT_SEARCH)).not.toContain('web_search');
  });

  it('describes every tool with parameters the API will accept', () => {
    for (const spec of buildToolKit(WITH_SEARCH).specs) {
      expect(spec.description.length).toBeGreaterThan(0);
      expect(spec.parameters).toMatchObject({ type: 'object' });
    }
  });

  it('orders the specs identically across builds, so the cached prefix holds', () => {
    // Tool specs sit inside OpenAI's cached prefix; a list that reordered
    // between turns would quietly cost the caching discount.
    expect(names(WITH_SEARCH)).toEqual(names(WITH_SEARCH));
  });

  it('omits camera_look on a build with no camera', () => {
    // Expo Go and the simulator: same rule as web_search without a key.
    expect(names(WITHOUT_SEARCH)).not.toContain('camera_look');
  });

  it('offers camera_look when the camera is there', () => {
    expect(names({ tavilyKey: null, vision: stubVision(), errands: null })).toContain('camera_look');
  });

  it('omits ask_other_half when no hermes is configured', () => {
    expect(names(WITHOUT_SEARCH)).not.toContain('ask_other_half');
  });

  it('offers tell_other_half alongside it — one gateway, both directions', () => {
    expect(names({ ...WITHOUT_SEARCH, errands: stubErrands() })).toContain('tell_other_half');
    expect(names(WITHOUT_SEARCH)).not.toContain('tell_other_half');
  });

  it('offers ask_other_half when one is', () => {
    expect(names({ ...WITHOUT_SEARCH, errands: stubErrands({ start: () => 'id' }) })).toContain('ask_other_half');
  });
});

describe('ask_other_half', () => {
  const call = (args: string) => ({ id: 'c1', name: 'ask_other_half', arguments: args });

  it('returns without waiting, so the round settles at local speed', async () => {
    // The point of the whole design: a hermes answer was measured at 88.7s and
    // cannot be inside the turn that asked for it. `start` is synchronous.
    let started: [string, boolean] | null = null;
    const kit = buildToolKit({
      ...WITHOUT_SEARCH,
      errands: stubErrands({
        start: (q, needs) => {
          started = [q, needs];
          return 'e1';
        },
      }),
    });
    const res = await kit.run(call('{"question":"is the offsite confirmed","needs_lookup":true}'));
    expect(started).toEqual(['is the offsite confirmed', true]);
    expect(res.message.content).toMatch(/come back to him/i);
  });

  it('passes the lookup flag through, since it is most of the wall-clock', async () => {
    let needs: boolean | null = null;
    const kit = buildToolKit({
      ...WITHOUT_SEARCH,
      errands: stubErrands({
        start: (_q, n) => {
          needs = n;
          return 'e1';
        },
      }),
    });
    await kit.run(call('{"question":"what did he decide about the rewrite","needs_lookup":false}'));
    expect(needs).toBe(false);
  });

  it('has her decline rather than promise when she is already full', async () => {
    const kit = buildToolKit({ ...WITHOUT_SEARCH, errands: stubErrands({ start: () => null }) });
    const res = await kit.run(call('{"question":"anything","needs_lookup":true}'));
    expect(res.message.content).toMatch(/still working through/i);
  });

  it('refuses an empty question rather than sending one', async () => {
    const kit = buildToolKit({ ...WITHOUT_SEARCH, errands: stubErrands() });
    const res = await kit.run(call('{"question":"  ","needs_lookup":true}'));
    expect(res.message.content).toMatch(/^Error:/);
  });

  it('says plainly there is no way to ask when hermes is absent', async () => {
    const res = await buildToolKit(WITHOUT_SEARCH).run(call('{"question":"anything","needs_lookup":true}'));
    expect(res.message.content).toMatch(/^Error:/);
  });
});

describe('tell_other_half', () => {
  const call = (args: string) =>
    ({ id: 'c1', name: 'tell_other_half', arguments: args }) as const;
  const ADD = '{"action":"Add milk to Michael\'s todo list","changes_existing":false}';
  const MOVE = '{"action":"Move the three o clock to tomorrow","changes_existing":true}';

  it('sends an additive action straight through, with nothing to confirm', async () => {
    let sent: string | null = null;
    const kit = buildToolKit({ ...WITHOUT_SEARCH, errands: stubErrands({ send: (a) => ((sent = a), 'a1') }) });
    const gate = jest.fn(async () => true);
    const res = await kit.run(call(ADD), { onConsent: gate });
    expect(sent).toBe("Add milk to Michael's todo list");
    expect(gate).not.toHaveBeenCalled();
    expect(res.message.content).toMatch(/passed to him|handed it over/i);
  });

  it('never reports an action as already done', async () => {
    // It is not done for another minute or two, and Eva reads this out as fact.
    const kit = buildToolKit({ ...WITHOUT_SEARCH, errands: stubErrands() });
    const res = await kit.run(call(ADD), { onConsent: async () => true });
    expect(res.message.content).toMatch(/do not say it is done/i);
  });

  it('asks out loud before changing something that already exists', async () => {
    let sent: string | null = null;
    const kit = buildToolKit({ ...WITHOUT_SEARCH, errands: stubErrands({ send: (a) => ((sent = a), 'a1') }) });
    const asked: (string | undefined)[] = [];
    const res = await kit.run(call(MOVE), {
      onConsent: async (q) => {
        asked.push(q);
        return true;
      },
    });
    expect(asked).toHaveLength(1);
    // The readback has to name the thing being agreed to; the camera's fixed
    // question cannot serve here.
    expect(asked[0]).toContain('move the three o clock to tomorrow');
    expect(sent).toBe('Move the three o clock to tomorrow');
    expect(res.message.content).toMatch(/passed to him|handed it over/i);
  });

  it('sends nothing at all when he says no', async () => {
    let sent: string | null = null;
    const kit = buildToolKit({ ...WITHOUT_SEARCH, errands: stubErrands({ send: (a) => ((sent = a), 'a1') }) });
    const res = await kit.run(call(MOVE), { onConsent: async () => false });
    expect(sent).toBeNull();
    expect(res.message.content).toMatch(/said no/i);
    expect(res.message.content).toMatch(/nothing has been changed/i);
  });

  it('treats a missing flag as destructive, unlike needs_lookup next door', async () => {
    // The two default in opposite directions on purpose: an unnecessary
    // question costs a breath, an unasked one costs a meeting.
    const kit = buildToolKit({ ...WITHOUT_SEARCH, errands: stubErrands() });
    const gate = jest.fn(async () => true);
    await kit.run(call('{"action":"Cancel the standup"}'), { onConsent: gate });
    expect(gate).toHaveBeenCalled();
  });

  it('declines rather than firing when there is no way to ask', async () => {
    // The same guarantee the camera makes: unasked is not allowed.
    let sent: string | null = null;
    const kit = buildToolKit({ ...WITHOUT_SEARCH, errands: stubErrands({ send: (a) => ((sent = a), 'a1') }) });
    const res = await kit.run(call(MOVE));
    expect(sent).toBeNull();
    expect(res.message.content).toMatch(/^Error:/);
  });

  it('still sends an additive action with no gate available', async () => {
    // Nothing to confirm, so a transport without a microphone is no obstacle.
    let sent: string | null = null;
    const kit = buildToolKit({ ...WITHOUT_SEARCH, errands: stubErrands({ send: (a) => ((sent = a), 'a1') }) });
    await kit.run(call(ADD));
    expect(sent).toBe("Add milk to Michael's todo list");
  });

  it('has her decline rather than promise when she is already full', async () => {
    const kit = buildToolKit({ ...WITHOUT_SEARCH, errands: stubErrands({ send: () => null }) });
    const res = await kit.run(call(ADD));
    expect(res.message.content).toMatch(/still working through/i);
  });

  it('refuses an empty action rather than sending one', async () => {
    const kit = buildToolKit({ ...WITHOUT_SEARCH, errands: stubErrands() });
    const res = await kit.run(call('{"action":"  ","changes_existing":false}'));
    expect(res.message.content).toMatch(/^Error:/);
  });

  it('says plainly there is no way to act when hermes is absent', async () => {
    const res = await buildToolKit(WITHOUT_SEARCH).run(call(ADD));
    expect(res.message.content).toMatch(/^Error:/);
  });
});

describe('buildToolKit dispatch', () => {
  const kit = buildToolKit(WITH_SEARCH);

  it('answers the clock without arguments', async () => {
    const { message } = await kit.run({ id: 'call_1', name: 'clock', arguments: '{}' });
    expect(message.role).toBe('tool');
    expect(message.content).toMatch(/\d/);
  });

  it('echoes the tool_call_id, which is how the API pairs answer to call', async () => {
    const { message } = await kit.run({ id: 'call_xyz', name: 'clock', arguments: '{}' });
    expect(message.tool_call_id).toBe('call_xyz');
  });

  it('reports an unknown tool rather than throwing', async () => {
    const { message } = await kit.run({ id: 'call_1', name: 'launch_missiles', arguments: '{}' });
    expect(message.content.toLowerCase()).toContain('error');
  });

  it('reports unparseable arguments rather than throwing', async () => {
    // This is the truncated-tool-call path: max_tokens can cut the arguments
    // off mid-JSON, and sse.ts deliberately emits the call anyway.
    const { message } = await kit.run({ id: 'call_1', name: 'web_search', arguments: '{"query":"unfin' });
    expect(message.content.toLowerCase()).toContain('error');
  });

  it('reports a missing required argument rather than searching for nothing', async () => {
    const { message } = await kit.run({ id: 'call_1', name: 'web_search', arguments: '{}' });
    expect(message.content.toLowerCase()).toContain('error');
  });

  it('tolerates empty arguments on a tool that takes none', async () => {
    // The API sends '' rather than '{}' when a function has no parameters.
    const { message } = await kit.run({ id: 'call_1', name: 'clock', arguments: '' });
    expect(message.content.toLowerCase()).not.toContain('error');
  });
});

// The consent gate is the whole feature. These are the paths that must never
// end in a shutter.
describe('camera_look', () => {
  const photo: Photo = { id: 'p1', uri: 'file:///p1.jpg', dataUrl: 'data:image/jpeg;base64,xx', takenAt: 0 };
  const call = { id: 'call_1', name: 'camera_look', arguments: '{"looking_for":"what he is holding"}' };

  function vision(over: Partial<VisionHandles> = {}): VisionHandles {
    return {
      ensurePermission: jest.fn(async () => true),
      showPreview: jest.fn(),
      hidePreview: jest.fn(),
      takePhoto: jest.fn(async () => ({ photo })),
      ...over,
    } as VisionHandles;
  }

  const yes = async () => true;
  const no = async () => false;

  it('returns the photo when consent is given', async () => {
    const result = await buildToolKit({ tavilyKey: null, vision: vision(), errands: null }).run(call, { onConsent: yes });
    expect(result.photo).toBe(photo);
    expect(result.message.content.toLowerCase()).not.toContain('error');
  });

  it('does not take a photo when consent is refused', async () => {
    const v = vision();
    const result = await buildToolKit({ tavilyKey: null, vision: v, errands: null }).run(call, { onConsent: no });
    expect(v.takePhoto).not.toHaveBeenCalled();
    expect(result.photo).toBeUndefined();
  });

  it('refuses outright when there is no way to ask', async () => {
    // A transport with no spoken gate (Slack) must not become a silent shutter.
    const v = vision();
    const result = await buildToolKit({ tavilyKey: null, vision: v, errands: null }).run(call, {});
    expect(v.takePhoto).not.toHaveBeenCalled();
    expect(result.message.content.toLowerCase()).toContain('error');
  });

  it('settles the iOS permission before anything is asked out loud', async () => {
    // The permission dialog is a modal; one appearing over an open microphone
    // would swallow the answer to the question we just asked.
    const order: string[] = [];
    const v = vision({
      ensurePermission: jest.fn(async () => {
        order.push('permission');
        return true;
      }),
    });
    await buildToolKit({ tavilyKey: null, vision: v, errands: null }).run(call, {
      onConsent: async () => {
        order.push('asked');
        return true;
      },
    });
    expect(order).toEqual(['permission', 'asked']);
  });

  it('never asks when iOS has denied the camera', async () => {
    const asked = jest.fn(async () => true);
    const v = vision({ ensurePermission: jest.fn(async () => false) });
    const result = await buildToolKit({ tavilyKey: null, vision: v, errands: null }).run(call, { onConsent: asked });
    expect(asked).not.toHaveBeenCalled();
    expect(result.message.content.toLowerCase()).toContain('error');
  });

  it('takes the viewfinder down on every path', async () => {
    for (const [consent, handles] of [
      [yes, vision()],
      [no, vision()],
      [yes, vision({ takePhoto: jest.fn(async () => ({ error: 'the camera failed' })) })],
    ] as const) {
      const v = handles;
      await buildToolKit({ tavilyKey: null, vision: v, errands: null }).run(call, { onConsent: consent });
      expect(v.hidePreview).toHaveBeenCalled();
    }
  });

  it('reports a failed shutter rather than throwing', async () => {
    const v = vision({
      takePhoto: jest.fn(async () => {
        throw new Error('boom');
      }),
    });
    // A throw here would take down a round that is already speaking aloud, so
    // even a handle that breaks its own contract has to come back as words.
    const result = await buildToolKit({ tavilyKey: null, vision: v, errands: null }).run(call, { onConsent: yes });
    expect(result.message.content.toLowerCase()).toContain('error');
    expect(result.photo).toBeUndefined();
    expect(v.hidePreview).toHaveBeenCalled();
  });

  it('reports a gate that rejects rather than throwing', async () => {
    const v = vision();
    const result = await buildToolKit({ tavilyKey: null, vision: v, errands: null }).run(call, {
      onConsent: async () => {
        throw new Error('round cancelled');
      },
    });
    expect(v.takePhoto).not.toHaveBeenCalled();
    expect(result.message.content.toLowerCase()).toContain('error');
  });
});

function stubVision(): VisionHandles {
  return {
    ensurePermission: async () => true,
    showPreview: () => {},
    hidePreview: () => {},
    takePhoto: async () => ({ error: 'no camera' }),
  };
}
