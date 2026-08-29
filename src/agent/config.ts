// Persisted OpenAI credentials for the dedicated device. Same posture as
// src/slack/config.ts: the key lives in AsyncStorage in plaintext by design.
// expo-secure-store is a native module and would force an EAS rebuild, and this
// is one phone on one desk. Note that EXPO_PUBLIC_* vars are inlined into the JS
// bundle at Metro start, so they are not secret from the bundle either.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_MODEL, DEFAULT_REALTIME_MODEL } from './models';

// Re-exported so callers have one import for configuration; the values live in
// models.ts because scripts/ needs them without AsyncStorage.
export { DEFAULT_MODEL, MODEL_PRESETS, DEFAULT_REALTIME_MODEL, REALTIME_MODEL_PRESETS } from './models';

export interface AgentConfig {
  /** OpenAI API key (sk-…). */
  apiKey: string;
  /** Chat completions model id. */
  model: string;
}

export const AGENT_CONFIG_KEY = 'eva.agentConfig.v1';

/** The model chosen from the dev overlay. Separate from the credential record. */
export const AGENT_MODEL_KEY = 'eva.agentModel.v1';

/** The realtime brain's model choice. Separate from the chat brain's. */
export const REALTIME_MODEL_KEY = 'eva.realtimeModel.v1';


/**
 * Dev-time source: EXPO_PUBLIC_OPENAI_* from .env.local (gitignored, inlined at
 * Metro start). Present → wins over anything persisted.
 */
export function envAgentInput(): AgentConfig | null {
  const apiKey = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  if (!apiKey) return null;
  return { apiKey, model: process.env.EXPO_PUBLIC_OPENAI_MODEL || DEFAULT_MODEL };
}

/** The model chosen from the overlay, or null when none has been. */
export async function getModelOverride(): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(AGENT_MODEL_KEY);
    return raw && raw.trim() ? raw.trim() : null;
  } catch {
    return null;
  }
}

/** Persist an overlay choice; null clears it and hands the decision back down the chain. */
export async function setModelOverride(model: string | null): Promise<void> {
  try {
    if (model && model.trim()) await AsyncStorage.setItem(AGENT_MODEL_KEY, model.trim());
    else await AsyncStorage.removeItem(AGENT_MODEL_KEY);
  } catch {
    // Losing the choice across a restart beats crashing the face.
  }
}

/**
 * Which model to talk to, resolved independently of where the API key came
 * from. That separation is the point: `envAgentInput()` returns key *and*
 * model together, and bring-up prefers it wholesale, so on a device with
 * EXPO_PUBLIC_OPENAI_API_KEY set — which is every device here — a model
 * persisted alongside the credentials would never be read at all.
 *
 *   overlay choice  →  EXPO_PUBLIC_OPENAI_MODEL  →  DEFAULT_MODEL
 */
export async function resolveModel(): Promise<string> {
  const override = await getModelOverride();
  if (override) return override;
  const fromEnv = process.env.EXPO_PUBLIC_OPENAI_MODEL;
  return fromEnv && fromEnv.trim() ? fromEnv.trim() : DEFAULT_MODEL;
}

/**
 * The realtime brain's model, on its own key.
 *
 * Deliberately not the same override as the chat brain's: the two cycle
 * through different preset lists, and one key would let a tap on one brain
 * leave the other pointing at a model it cannot reach at all.
 *
 *   overlay choice  →  EXPO_PUBLIC_OPENAI_REALTIME_MODEL  →  DEFAULT_REALTIME_MODEL
 */
export async function resolveRealtimeModel(): Promise<string> {
  try {
    const raw = await AsyncStorage.getItem(REALTIME_MODEL_KEY);
    if (raw && raw.trim()) return raw.trim();
  } catch {
    // fall through to the env and the default
  }
  const fromEnv = process.env.EXPO_PUBLIC_OPENAI_REALTIME_MODEL;
  return fromEnv && fromEnv.trim() ? fromEnv.trim() : DEFAULT_REALTIME_MODEL;
}

export async function setRealtimeModelOverride(model: string | null): Promise<void> {
  try {
    if (model && model.trim()) await AsyncStorage.setItem(REALTIME_MODEL_KEY, model.trim());
    else await AsyncStorage.removeItem(REALTIME_MODEL_KEY);
  } catch {
    // Losing the choice across a restart beats crashing the face.
  }
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
