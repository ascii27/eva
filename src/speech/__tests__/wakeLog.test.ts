import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import AsyncStorage from '@react-native-async-storage/async-storage';
import { appendWakeEvent, clearWakeEvents, getWakeEvents, MAX_EVENTS, WAKE_LOG_KEY } from '../wakeLog';

beforeEach(() => AsyncStorage.clear());

describe('wakeLog', () => {
  it('starts empty', async () => {
    expect(await getWakeEvents()).toEqual([]);
  });

  it('appends events and reads them back with timestamps', async () => {
    await appendWakeEvent('hey eva what time is it');
    const events = await getWakeEvents();
    expect(events).toHaveLength(1);
    expect(events[0].snippet).toBe('hey eva what time is it');
    expect(typeof events[0].ts).toBe('number');
  });

  it('returns the updated list from append', async () => {
    await appendWakeEvent('first');
    const events = await appendWakeEvent('second');
    expect(events.map((e) => e.snippet)).toEqual(['first', 'second']);
  });

  it('trims oldest events beyond the cap', async () => {
    const many = Array.from({ length: MAX_EVENTS }, (_, i) => ({ ts: i, snippet: `e${i}` }));
    await AsyncStorage.setItem(WAKE_LOG_KEY, JSON.stringify(many));
    const events = await appendWakeEvent('newest');
    expect(events).toHaveLength(MAX_EVENTS);
    expect(events[0].snippet).toBe('e1');
    expect(events[events.length - 1].snippet).toBe('newest');
  });

  it('clears the log', async () => {
    await appendWakeEvent('hey eva');
    await clearWakeEvents();
    expect(await getWakeEvents()).toEqual([]);
  });

  it('tolerates corrupt stored JSON', async () => {
    await AsyncStorage.setItem(WAKE_LOG_KEY, 'not json{');
    expect(await getWakeEvents()).toEqual([]);
    const events = await appendWakeEvent('recovered');
    expect(events.map((e) => e.snippet)).toEqual(['recovered']);
  });
});
