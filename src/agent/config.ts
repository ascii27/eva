// Persisted OpenAI credentials for the dedicated device. Same posture as
// src/slack/config.ts: the key lives in AsyncStorage in plaintext by design.
// expo-secure-store is a native module and would force an EAS rebuild, and this
// is one phone on one desk. Note that EXPO_PUBLIC_* vars are inlined into the JS
// bundle at Metro start, so they are not secret from the bundle either.

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface AgentConfig {
  /** OpenAI API key (sk-…). */
  apiKey: string;
  /** Chat completions model id. */
  model: string;
}

export const AGENT_CONFIG_KEY = 'eva.agentConfig.v1';

/**
 * Cheap, fast, and — unlike gpt-3.5-turbo — eligible for automatic prompt
 * caching, which is what makes a growing conversation affordable.
 */
export const DEFAULT_MODEL = 'gpt-4o-mini';

/**
 * Dev-time source: EXPO_PUBLIC_OPENAI_* from .env.local (gitignored, inlined at
 * Metro start). Present → wins over anything persisted.
 */
export function envAgentInput(): AgentConfig | null {
  const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  if (!apiKey) return null;
  return { apiKey, model: process.env.EXPO_PUBLIC_OPENAI_MODEL || DEFAULT_MODEL };
}

/**
 * Tavily key for the web-search tool, from .env.local. Env-only on purpose:
 * there is no pairing screen for it, and its absence is a supported state —
 * the tool is simply not offered (see src/agent/tools/index.ts).
 */
export function envTavilyKey(): string | null {
  return process.env.EXPO_PUBLIC_TAVILY_API_KEY || null;
}

export async function getAgentConfig(): Promise<AgentConfig | null> {
  try {
    const raw = await AsyncStorage.getItem(AGENT_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.apiKey !== 'string' || !parsed.apiKey) return null;
    return { apiKey: parsed.apiKey, model: typeof parsed.model === 'string' && parsed.model ? parsed.model : DEFAULT_MODEL };
  } catch {
    return null;
  }
}

export async function setAgentConfig(config: AgentConfig): Promise<void> {
  try {
    await AsyncStorage.setItem(AGENT_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // Persistence failure means re-entering the key after a restart, never a crash.
  }
}

export async function clearAgentConfig(): Promise<void> {
  try {
    await AsyncStorage.removeItem(AGENT_CONFIG_KEY);
  } catch {
    // ignore
  }
}
