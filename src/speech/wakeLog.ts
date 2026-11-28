// Persistent wake-event log backing the PRD's false-trigger measurement:
// every detection is stored with its timestamp and the transcript snippet
// that triggered it, so a day of entries can be classified intended vs false
// from the dev overlay.

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface WakeEvent {
  /** Epoch milliseconds of the detection. */
  ts: number;
  /** Normalized transcript snippet that matched. */
  snippet: string;
}

export const WAKE_LOG_KEY = 'eva.wakeLog.v1';
export const MAX_EVENTS = 300;

/**
 * What she heard when she *didn't* wake (ASC-37): one snippet per recognizer
 * session that sounded like an attempt. Kept apart from wake events so the
 * false-trigger count stays honest. On-device only, short snippets, capped.
 */
export const NEAR_MISS_KEY = 'eva.wakeNearMiss.v1';

export async function readLog(key: string): Promise<WakeEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function appendLog(key: string, snippet: string): Promise<WakeEvent[]> {
  const events = await readLog(key);
  events.push({ ts: Date.now(), snippet });
  const capped = events.slice(-MAX_EVENTS);
  try {
    await AsyncStorage.setItem(key, JSON.stringify(capped));
  } catch {
    // Storage failure loses history, never the face.
  }
  return capped;
}

export async function clearLog(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export const getWakeEvents = (): Promise<WakeEvent[]> => readLog(WAKE_LOG_KEY);
/** Append a detection; returns the updated (FIFO-capped) list. */
export const appendWakeEvent = (snippet: string): Promise<WakeEvent[]> => appendLog(WAKE_LOG_KEY, snippet);
export const clearWakeEvents = (): Promise<void> => clearLog(WAKE_LOG_KEY);

export const getNearMisses = (): Promise<WakeEvent[]> => readLog(NEAR_MISS_KEY);
export const appendNearMiss = (snippet: string): Promise<WakeEvent[]> => appendLog(NEAR_MISS_KEY, snippet);
export const clearNearMisses = (): Promise<void> => clearLog(NEAR_MISS_KEY);
