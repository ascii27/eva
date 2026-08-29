import { describe, expect, it } from '@jest/globals';
import {
  decode,
  deleteItem,
  functionOutput,
  responseCreate,
  seed,
  sessionUpdate,
  userImage,
} from '../protocol';
import type { ChatMessage } from '../../agent/history';
import type { ToolSpec } from '../../agent/openai';

const frame = (ev: Record<string, unknown>) => JSON.stringify(ev);

const SPECS: ToolSpec[] = [
  { name: 'clock', description: 'the time', parameters: { type: 'object', properties: {} } },
];

describe('sessionUpdate', () => {
  it('uses the GA field names, not the beta ones', () => {
    const session = sessionUpdate({ instructions: 'be Eva', specs: SPECS }).session as Record<
      string,
      unknown
    >;
    expect(session.type).toBe('realtime');
    expect(session.output_modalities).toEqual(['text']);
    // beta's spelling — present would mean a session that never speaks
    expect(session.modalities).toBeUndefined();
  });

  it('flattens tool specs, where chat completions nests them', () => {
    const session = sessionUpdate({ instructions: '', specs: SPECS }).session as Record<string, unknown>;
    expect(session.tools).toEqual([
      { type: 'function', name: 'clock', description: 'the time', parameters: SPECS[0].parameters },
    ]);
  });

  it('nulls turn detection, so only response.create starts a reply', () => {
    const session = sessionUpdate({ instructions: '', specs: [] }).session as Record<string, unknown>;
    expect(session.audio).toEqual({ input: { turn_detection: null } });
  });
});

describe('responseCreate', () => {
  it('omits tool_choice unless asked, and sets none for a forced answer', () => {
    expect((responseCreate().response as Record<string, unknown>).tool_choice).toBeUndefined();
    expect((responseCreate({ toolChoice: 'none' }).response as Record<string, unknown>).tool_choice).toBe(
      'none',
    );
  });
});

describe('decode', () => {
  it('reads a text delta off the GA event name', () => {
    expect(
      decode(
        frame({
          type: 'response.output_text.delta',
          delta: 'hello',
          response_id: 'resp_1',
          item_id: 'item_1',
        }),
      ),
    ).toEqual({ kind: 'delta', responseId: 'resp_1', itemId: 'item_1', text: 'hello' });
  });

  it('does not mistake the beta delta name for a delta', () => {
    const ev = decode(frame({ type: 'response.text.delta', delta: 'hello' }));
    expect(ev).toEqual({ kind: 'other', type: 'response.text.delta' });
  });

  it('surfaces an assembled tool call in the shape the toolkit already takes', () => {
    expect(
      decode(
        frame({
          type: 'response.function_call_arguments.done',
          call_id: 'call_9',
          name: 'clock',
          arguments: '{"tz":"local"}',
          response_id: 'resp_1',
          item_id: 'item_2',
        }),
      ),
    ).toEqual({
      kind: 'tool-call',
      responseId: 'resp_1',
      itemId: 'item_2',
      call: { id: 'call_9', name: 'clock', arguments: '{"tz":"local"}' },
    });
  });

  it('maps usage onto ChatUsage, cached tokens included', () => {
    expect(
      decode(
        frame({
          type: 'response.done',
          response: {
            id: 'resp_1',
            status: 'completed',
            usage: { input_tokens: 400, output_tokens: 20, input_token_details: { cached_tokens: 256 } },
          },
        }),
      ),
    ).toEqual({
      kind: 'done',
      responseId: 'resp_1',
      status: 'completed',
      usage: { promptTokens: 400, cachedTokens: 256, completionTokens: 20 },
    });
  });

  it('reports a cancelled response as done, so a round can stop waiting', () => {
    const ev = decode(frame({ type: 'response.done', response: { id: 'r', status: 'cancelled' } }));
    expect(ev).toMatchObject({ kind: 'done', status: 'cancelled', usage: null });
  });

  it('carries the error message through', () => {
    expect(decode(frame({ type: 'error', error: { message: 'bad session' } }))).toEqual({
      kind: 'error',
      message: 'bad session',
    });
  });

  it('collapses events nothing branches on rather than dropping them', () => {
    expect(decode(frame({ type: 'rate_limits.updated' }))).toEqual({
      kind: 'other',
      type: 'rate_limits.updated',
    });
  });

  it('returns null only for something that is not an event', () => {
    expect(decode('not json')).toBeNull();
    expect(decode('null')).toBeNull();
    expect(decode('42')).toBeNull();
    expect(decode('[]')).toBeNull();
  });
});

describe('seed', () => {
  const persona: ChatMessage = { role: 'system', content: 'You are Eva.' };

  it('lifts the leading system message into instructions and replays the rest', () => {
    const s = seed([
      persona,
      { role: 'system', content: 'Earlier: he likes tea.' },
      { role: 'user', content: 'what time is it' },
      { role: 'assistant', content: 'Just gone four.' },
    ]);
    expect(s.instructions).toBe('You are Eva.');
    expect(s.items).toHaveLength(3);
    expect(s.items[0]).toMatchObject({
      item: { role: 'system', content: [{ type: 'input_text', text: 'Earlier: he likes tea.' }] },
    });
    expect(s.items[1]).toMatchObject({ item: { role: 'user' } });
    // an assistant turn replays as output_text, not input_text
    expect(s.items[2]).toMatchObject({
      item: { role: 'assistant', content: [{ type: 'output_text', text: 'Just gone four.' }] },
    });
  });

  it('keeps a photo turn as one item, caption before image', () => {
    const s = seed([
      persona,
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what am I holding' },
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAA' } },
        ],
      },
    ]);
    const content = (s.items[0] as { item: { content: Record<string, unknown>[] } }).item.content;
    expect(content[0]).toEqual({ type: 'input_text', text: 'what am I holding' });
    expect(content[1]).toMatchObject({ type: 'input_image', image_url: 'data:image/jpeg;base64,AAA' });
  });

  it('degrades an aged-out photo to its caption alone', () => {
    const s = seed([persona, { role: 'user', content: [{ type: 'text', text: '(photo taken earlier)' }] }]);
    expect(s.items[0]).toMatchObject({
      item: { content: [{ type: 'input_text', text: '(photo taken earlier)' }] },
    });
  });

  it('replays everything when the request does not open with a system message', () => {
    const s = seed([{ role: 'user', content: 'hello' }]);
    expect(s.instructions).toBe('');
    expect(s.items).toHaveLength(1);
  });
});

describe('items', () => {
  it('answers a tool call by id', () => {
    expect(functionOutput('call_9', 'It is four.')).toEqual({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: 'call_9', output: 'It is four.' },
    });
  });

  it('can drop a photo item once a round has settled', () => {
    expect(deleteItem('item_7')).toEqual({ type: 'conversation.item.delete', item_id: 'item_7' });
  });

  it('sends an image with no caption when there is none', () => {
    const content = (userImage('data:image/jpeg;base64,AAA') as { item: { content: unknown[] } }).item
      .content;
    expect(content).toHaveLength(1);
  });
});
