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

export async function getWakeEvents(): Promise<WakeEvent[]> {
  try {
    const raw = await AsyncStorage.getItem(WAKE_LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Append a detection; returns the updated (FIFO-capped) list. */
export async function appendWakeEvent(snippet: string): Promise<WakeEvent[]> {
  const events = await getWakeEvents();
  events.push({ ts: Date.now(), snippet });
  const capped = events.slice(-MAX_EVENTS);
  try {
    await AsyncStorage.setItem(WAKE_LOG_KEY, JSON.stringify(capped));
  } catch {
    // Storage failure loses history, never the face.
  }
  return capped;
}

export async function clearWakeEvents(): Promise<void> {
  try {
    await AsyncStorage.removeItem(WAKE_LOG_KEY);
  } catch {
    // ignore
  }
}
