import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => void store.set(k, v),
      removeItem: async (k: string) => void store.delete(k),
    },
    __store: store,
  };
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_MODEL, MODEL_PRESETS, getModelOverride, resolveModel, setModelOverride } from '../config';

const store = (AsyncStorage as unknown as { __store: Map<string, string> }).__store ??
  (jest.requireMock('@react-native-async-storage/async-storage') as { __store: Map<string, string> }).__store;

const ENV = 'EXPO_PUBLIC_OPENAI_MODEL';

beforeEach(() => {
  store.clear();
  delete process.env[ENV];
});

afterEach(() => {
  delete process.env[ENV];
});

describe('resolveModel', () => {
  it('falls back to the default when nothing is set', async () => {
    expect(await resolveModel()).toBe(DEFAULT_MODEL);
  });

  it('uses the env model when there is no override', async () => {
    process.env[ENV] = 'gpt-4o-mini';
    expect(await resolveModel()).toBe('gpt-4o-mini');
  });

  it('lets a persisted override outrank the env model', async () => {
    // The whole point of the override: the env key is set on this device, and
    // an overlay choice that lost to it would silently do nothing.
    process.env[ENV] = 'gpt-4o-mini';
    await setModelOverride('o4-mini');
    expect(await resolveModel()).toBe('o4-mini');
  });

  it('lets a persisted override outrank the default', async () => {
    await setModelOverride('o4-mini');
    expect(await resolveModel()).toBe('o4-mini');
  });

  it('ignores a blank override rather than asking for a nameless model', async () => {
    await setModelOverride('   ');
    expect(await resolveModel()).toBe(DEFAULT_MODEL);
  });

  it('ignores a blank env value', async () => {
    process.env[ENV] = '';
    expect(await resolveModel()).toBe(DEFAULT_MODEL);
  });

  it('forgets the override when cleared, falling back down the chain', async () => {
    process.env[ENV] = 'gpt-4o-mini';
    await setModelOverride('o4-mini');
    await setModelOverride(null);
    expect(await resolveModel()).toBe('gpt-4o-mini');
  });

  it('round-trips the override', async () => {
    await setModelOverride('gpt-5.4');
    expect(await getModelOverride()).toBe('gpt-5.4');
  });
});

describe('MODEL_PRESETS', () => {
  it('leads with the default, so cycling starts where the device already is', () => {
    expect(MODEL_PRESETS[0]).toBe(DEFAULT_MODEL);
  });

  it('has no duplicates, which would make a tap look like it did nothing', () => {
    expect(new Set(MODEL_PRESETS).size).toBe(MODEL_PRESETS.length);
  });

  it('keeps a model that does not emit preambles, so the difference stays testable', () => {
    expect(MODEL_PRESETS).toContain('gpt-4o-mini');
  });
});
