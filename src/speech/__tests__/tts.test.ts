import { beforeEach, describe, expect, it, jest } from '@jest/globals';

/** Captured options of the most recent Speech.speak call, so tests can drive its callbacks. */
const mockSpeech: {
  current: Record<string, any> | null;
  voicesError: Error | null;
  speak: jest.Mock;
  stop: jest.Mock;
} = {
  current: null,
  voicesError: null,
  speak: jest.fn((_text: unknown, opts: unknown) => {
    mockSpeech.current = opts as Record<string, any>;
  }),
  // Mirrors expo-speech: stopping an in-flight utterance reports onStopped.
  stop: jest.fn(() => {
    mockSpeech.current?.onStopped?.();
  }),
};

jest.mock('expo-speech', () => ({
  VoiceQuality: { Enhanced: 'Enhanced', Default: 'Default' },
  getAvailableVoicesAsync: async () => {
    if (mockSpeech.voicesError) throw mockSpeech.voicesError;
    return [];
  },
  speak: (text: unknown, opts: unknown) => mockSpeech.speak(text, opts),
  stop: () => mockSpeech.stop(),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async () => {} },
}));

const mockKokoro = {
  state: 'unavailable' as string,
  handlers: null as null | {
    onStart: () => void;
    onDone: () => void;
    onError: (e: unknown, audioStarted: boolean) => void;
  },
  speakWithKokoro: jest.fn(),
  stopKokoro: jest.fn(),
};

jest.mock('../kokoro', () => ({
  getTtsStatus: () => ({ state: mockKokoro.state }),
  initKokoro: async () => {},
  speakWithKokoro: (text: unknown, handlers: unknown) => {
    mockKokoro.handlers = handlers as typeof mockKokoro.handlers;
    mockKokoro.speakWithKokoro(text, handlers);
  },
  stopKokoro: () => {
    mockKokoro.handlers = null;
    mockKokoro.stopKokoro();
  },
}));

import { speak, stopSpeaking } from '../tts';

beforeEach(() => {
  stopSpeaking(); // clear any active utterance left by a prior test
  jest.clearAllMocks();
  mockSpeech.current = null;
  mockSpeech.voicesError = null;
  mockKokoro.state = 'unavailable';
  mockKokoro.handlers = null;
});

describe('system engine routing (kokoro not ready)', () => {
  it('speaks via expo-speech and forwards lifecycle callbacks', async () => {
    const cb = { onStart: jest.fn(), onDone: jest.fn(), onError: jest.fn() };
    await speak('hello', cb);
    expect(mockSpeech.speak).toHaveBeenCalledTimes(1);
    expect(mockKokoro.speakWithKokoro).not.toHaveBeenCalled();

    mockSpeech.current!.onStart();
    expect(cb.onStart).toHaveBeenCalledTimes(1);
    mockSpeech.current!.onDone();
    expect(cb.onDone).toHaveBeenCalledTimes(1);
  });

  it('reports a stopped utterance as done exactly once', async () => {
    const cb = { onDone: jest.fn() };
    await speak('hello', cb);
    stopSpeaking(); // settles directly AND triggers expo-speech onStopped
    expect(cb.onDone).toHaveBeenCalledTimes(1);
  });

  it('a second speak settles the first utterance once', async () => {
    const first = { onDone: jest.fn() };
    await speak('one', first);
    const second = { onDone: jest.fn() };
    await speak('two', second);
    expect(first.onDone).toHaveBeenCalledTimes(1);
    expect(second.onDone).not.toHaveBeenCalled();
  });

  it('settles with onError when voice resolution rejects', async () => {
    mockSpeech.voicesError = new Error('tts service down');
    const cb = { onDone: jest.fn(), onError: jest.fn() };
    await speak('hello', cb);
    expect(cb.onError).toHaveBeenCalledTimes(1);
    expect(cb.onDone).not.toHaveBeenCalled();
    expect(mockSpeech.speak).not.toHaveBeenCalled();
  });

  it('ignores late callbacks from a superseded utterance', async () => {
    const first = { onStart: jest.fn(), onDone: jest.fn() };
    await speak('one', first);
    const firstOpts = mockSpeech.current!;
    await speak('two', {});
    firstOpts.onStart();
    firstOpts.onDone();
    expect(first.onStart).not.toHaveBeenCalled();
    expect(first.onDone).toHaveBeenCalledTimes(1); // only the supersede-stop settle
  });
});

describe('kokoro engine routing (ready)', () => {
  beforeEach(() => {
    mockKokoro.state = 'ready';
  });

  it('routes to kokoro and forwards lifecycle callbacks', async () => {
    const cb = { onStart: jest.fn(), onDone: jest.fn() };
    await speak('hello', cb);
    expect(mockKokoro.speakWithKokoro).toHaveBeenCalledTimes(1);
    expect(mockSpeech.speak).not.toHaveBeenCalled();

    mockKokoro.handlers!.onStart();
    expect(cb.onStart).toHaveBeenCalledTimes(1);
    mockKokoro.handlers!.onDone();
    expect(cb.onDone).toHaveBeenCalledTimes(1);
  });

  it('stopSpeaking stops kokoro and fires onDone exactly once', async () => {
    const cb = { onDone: jest.fn() };
    await speak('hello', cb);
    const handlers = mockKokoro.handlers!;
    stopSpeaking();
    expect(mockKokoro.stopKokoro).toHaveBeenCalled();
    expect(cb.onDone).toHaveBeenCalledTimes(1);
    handlers.onDone(); // late drain must not double-fire
    expect(cb.onDone).toHaveBeenCalledTimes(1);
  });

  it('falls back to the system voice when kokoro fails before audio', async () => {
    const cb = { onStart: jest.fn(), onDone: jest.fn(), onError: jest.fn() };
    await speak('hello', cb);
    mockKokoro.handlers!.onError(new Error('load fail'), false);
    await Promise.resolve(); // let speakSystem resolve its voice
    await Promise.resolve();
    await Promise.resolve();
    expect(mockSpeech.speak).toHaveBeenCalledTimes(1);
    expect(cb.onError).not.toHaveBeenCalled();

    mockSpeech.current!.onStart();
    expect(cb.onStart).toHaveBeenCalledTimes(1);
    mockSpeech.current!.onDone();
    expect(cb.onDone).toHaveBeenCalledTimes(1);
  });

  it('reports onError without fallback when audio already started', async () => {
    const cb = { onDone: jest.fn(), onError: jest.fn() };
    await speak('hello', cb);
    mockKokoro.handlers!.onStart();
    mockKokoro.handlers!.onError(new Error('mid-stream'), true);
    await Promise.resolve();
    expect(cb.onError).toHaveBeenCalledTimes(1);
    expect(cb.onDone).not.toHaveBeenCalled();
    expect(mockSpeech.speak).not.toHaveBeenCalled();
  });
});
