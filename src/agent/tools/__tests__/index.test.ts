import { describe, expect, it } from '@jest/globals';
import { buildToolKit } from '../index';

const WITH_SEARCH = { tavilyKey: 'tvly-test' };
const WITHOUT_SEARCH = { tavilyKey: null };

const names = (cfg: { tavilyKey: string | null }) => buildToolKit(cfg).specs.map((s) => s.name);

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
});

describe('buildToolKit dispatch', () => {
  const kit = buildToolKit(WITH_SEARCH);

  it('answers the clock without arguments', async () => {
    const msg = await kit.run({ id: 'call_1', name: 'clock', arguments: '{}' });
    expect(msg.role).toBe('tool');
    expect(msg.content).toMatch(/\d/);
  });

  it('echoes the tool_call_id, which is how the API pairs answer to call', async () => {
    const msg = await kit.run({ id: 'call_xyz', name: 'clock', arguments: '{}' });
    expect(msg.tool_call_id).toBe('call_xyz');
  });

  it('reports an unknown tool rather than throwing', async () => {
    const msg = await kit.run({ id: 'call_1', name: 'launch_missiles', arguments: '{}' });
    expect(msg.content.toLowerCase()).toContain('error');
  });

  it('reports unparseable arguments rather than throwing', async () => {
    // This is the truncated-tool-call path: max_tokens can cut the arguments
    // off mid-JSON, and sse.ts deliberately emits the call anyway.
    const msg = await kit.run({ id: 'call_1', name: 'web_search', arguments: '{"query":"unfin' });
    expect(msg.content.toLowerCase()).toContain('error');
  });

  it('reports a missing required argument rather than searching for nothing', async () => {
    const msg = await kit.run({ id: 'call_1', name: 'web_search', arguments: '{}' });
    expect(msg.content.toLowerCase()).toContain('error');
  });

  it('tolerates empty arguments on a tool that takes none', async () => {
    // The API sends '' rather than '{}' when a function has no parameters.
    const msg = await kit.run({ id: 'call_1', name: 'clock', arguments: '' });
    expect(msg.content.toLowerCase()).not.toContain('error');
  });
});
