import { describe, expect, it, jest } from '@jest/globals';
import type { Photo } from '../../../vision/photos';
import { buildToolKit, type ToolConfig, type VisionHandles } from '../index';

const WITH_SEARCH: ToolConfig = { tavilyKey: 'tvly-test', vision: null };
const WITHOUT_SEARCH: ToolConfig = { tavilyKey: null, vision: null };

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
    expect(names({ tavilyKey: null, vision: stubVision() })).toContain('camera_look');
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
    const result = await buildToolKit({ tavilyKey: null, vision: vision() }).run(call, { onConsent: yes });
    expect(result.photo).toBe(photo);
    expect(result.message.content.toLowerCase()).not.toContain('error');
  });

  it('does not take a photo when consent is refused', async () => {
    const v = vision();
    const result = await buildToolKit({ tavilyKey: null, vision: v }).run(call, { onConsent: no });
    expect(v.takePhoto).not.toHaveBeenCalled();
    expect(result.photo).toBeUndefined();
  });

  it('refuses outright when there is no way to ask', async () => {
    // A transport with no spoken gate (Slack) must not become a silent shutter.
    const v = vision();
    const result = await buildToolKit({ tavilyKey: null, vision: v }).run(call, {});
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
    await buildToolKit({ tavilyKey: null, vision: v }).run(call, {
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
    const result = await buildToolKit({ tavilyKey: null, vision: v }).run(call, { onConsent: asked });
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
      await buildToolKit({ tavilyKey: null, vision: v }).run(call, { onConsent: consent });
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
    const result = await buildToolKit({ tavilyKey: null, vision: v }).run(call, { onConsent: yes });
    expect(result.message.content.toLowerCase()).toContain('error');
    expect(result.photo).toBeUndefined();
    expect(v.hidePreview).toHaveBeenCalled();
  });

  it('reports a gate that rejects rather than throwing', async () => {
    const v = vision();
    const result = await buildToolKit({ tavilyKey: null, vision: v }).run(call, {
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
