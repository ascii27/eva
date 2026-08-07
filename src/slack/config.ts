// Persisted Slack pairing for the dedicated device. Tokens live in
// AsyncStorage (plaintext) by design: expo-secure-store is a native module
// and would force an EAS rebuild, and the bot is scoped to one channel.

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface SlackConfig {
  /** Bot user OAuth token (xoxb-…). */
  botToken: string;
  /** App-level token with connections:write (xapp-…). */
  appToken: string;
  /** Channel the device talks to Eva in. */
  channelId: string;
  /** Eva's Slack user id. */
  evaUserId: string;
  /** Our own bot user id, captured from auth.test at pairing — for self-filtering. */
  botUserId: string;
}

export const SLACK_CONFIG_KEY = 'eva.slackConfig.v1';
export const DEFAULT_EVA_USER_ID = 'U0B7PD9CWSX';
/** #eva-direct */
export const DEFAULT_CHANNEL_ID = 'C0B7ZEBTVK6';

export async function getSlackConfig(): Promise<SlackConfig | null> {
  try {
    const raw = await AsyncStorage.getItem(SLACK_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.botToken !== 'string' || typeof parsed.appToken !== 'string') return null;
    return parsed as SlackConfig;
  } catch {
    return null;
  }
}

export async function setSlackConfig(config: SlackConfig): Promise<void> {
  try {
    await AsyncStorage.setItem(SLACK_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // Persistence failure means re-pairing after a restart, never a crash.
  }
}

export async function clearSlackConfig(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SLACK_CONFIG_KEY);
  } catch {
    // ignore
  }
}
