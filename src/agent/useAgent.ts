// The local agent loop: owns the OpenAI credentials, the live session, and the
// ask round trip. Owned by FaceScreen, mirroring useSlack.
//
// Same contract as the Slack transport — ask(text) resolves to exactly one
// AskResult — so useEcho cannot tell which brain answered. What differs is that
// the answer comes back in about a second instead of up to ninety, and that
// conversation state is ours to keep (see history.ts).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AskResult } from '../round/ask';
import { speakableFromMrkdwn } from '../round/speakable';
import { type AgentConfig, envAgentInput, getAgentConfig } from './config';
import {
  appendTurn,
  applyCompaction,
  buildRequest,
  isGap,
  MEMORY_LIMIT,
  newSession,
  planCompaction,
  type Session,
} from './history';
import { chat, type ChatUsage, formatUsage, type RequestMessage, type ToolCall, type ToolMessage, type ToolSpec } from './openai';
import { NOTHING_TO_REMEMBER, PERSONA, SUMMARIZE_SESSION, SUMMARIZE_TURNS } from './persona';
import { archiveSession, loadSession, recentMemories, saveSession } from './store';

/**
 * A local round should feel immediate; anything this slow has gone wrong rather
 * than gone slowly. Well under the Slack path's 90s, which was sized for a
 * human-speed agent doing real work.
 */
export const ASK_TIMEOUT_MS = 30_000;

/** Guard on the tool loop. No tools are defined yet, so today it never spins. */
const MAX_STEPS = 4;

/** Tool specs go here when there are any; omitted from the request while empty. */
const TOOLS: ToolSpec[] = [];

/**
 * Dispatch one tool call. Unreachable while TOOLS is empty — the model is never
 * offered a tool, so it cannot ask for one — but correctly shaped, so adding a
 * tool means adding a case here and an entry above, not restructuring the loop.
 */
async function runTool(call: ToolCall): Promise<ToolMessage> {
  return { role: 'tool', tool_call_id: call.id, content: `Error: no tool named ${call.name}.` };
}

/** Keeps replies short enough to be listenable, and caps the cost of a runaway. */
const MAX_REPLY_TOKENS = 300;

/** Summaries are cheap and shouldn't wander. */
const MAX_SUMMARY_TOKENS = 300;

export type AgentStatus = 'unconfigured' | 'ready';

export interface UseAgentOptions {
  /** Human-readable failures and per-round token spend, for the transcript. */
  onIssue?: (message: string) => void;
  /** Per-round token usage line, e.g. `agent · 412 in (256 cached) · 89 out`. */
  onUsage?: (line: string) => void;
}

export function useAgent({ onIssue, onUsage }: UseAgentOptions = {}) {
  const [status, setStatus] = useState<AgentStatus>('unconfigured');
  const [model, setModel] = useState<string | null>(null);
  const config = useRef<AgentConfig | null>(null);
  // The live session and the memory block. Refs, not state: ask() reads them
  // synchronously and nothing about the face changes when they move.
  const session = useRef<Session | null>(null);
  const memories = useRef<string[]>([]);
  // Non-null while a compaction is in flight, so a second round can't start one.
  const compacting = useRef(false);
  const callbacks = useRef({ onIssue, onUsage });
  callbacks.current = { onIssue, onUsage };

  /** One completion, outside the conversation — used for both summarizers. */
  const complete = useCallback(async (instruction: string, body: string): Promise<string | null> => {
    const cfg = config.current;
    if (!cfg) return null;
    try {
      const res = await chat({
        apiKey: cfg.apiKey,
        model: cfg.model,
        messages: [
          { role: 'system', content: instruction },
          { role: 'user', content: body },
        ],
        maxTokens: MAX_SUMMARY_TOKENS,
      });
      return res.text || null;
    } catch (e) {
      callbacks.current.onIssue?.(`agent · summary failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }, []);

  const transcriptOf = (s: Session): string =>
    s.turns.map((t) => `${t.role === 'user' ? 'Michael' : 'Eva'}: ${t.content}`).join('\n');

  /**
   * Close a session out to memory. The summary is what gets carried into later
   * conversations, so a session that left nothing worth keeping is archived
   * without one rather than with a hollow note.
   */
  const archive = useCallback(
    async (closing: Session, now: number): Promise<void> => {
      const body = closing.summary
        ? `Summary of the earlier part of this conversation:\n${closing.summary}\n\nThen:\n${transcriptOf(closing)}`
        : transcriptOf(closing);
      const summary = await complete(SUMMARIZE_SESSION, body);
      const keep = summary && summary.trim() !== NOTHING_TO_REMEMBER ? summary.trim() : null;
      await archiveSession(closing, keep, now);
      memories.current = await recentMemories(MEMORY_LIMIT);
      if (keep) callbacks.current.onIssue?.('agent · remembered this conversation');
    },
    [complete],
  );

  // Bring-up: credentials, then the live session — archiving it first if the
  // device has been quiet long enough that it counts as a finished conversation.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cfg = envAgentInput() ?? (await getAgentConfig());
      if (cancelled) return;
      config.current = cfg;
      setModel(cfg?.model ?? null);
      setStatus(cfg ? 'ready' : 'unconfigured');
      if (!cfg) {
        callbacks.current.onIssue?.('agent · no API key configured');
        return;
      }

      const loaded = await loadSession();
      if (cancelled) return;
      const now = Date.now();
      if (loaded && isGap(loaded, now)) {
        session.current = newSession(now);
        await saveSession(session.current);
        await archive(loaded, now); // needs the key, so it waits for bring-up
      } else {
        session.current = loaded ?? newSession(now);
        memories.current = await recentMemories(MEMORY_LIMIT);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [archive]);

  /**
   * Fold the oldest turns into the running summary. Runs after the round has
   * already been answered — never in its critical path — and drops by count so
   * anything the user said meanwhile survives (see applyCompaction).
   */
  const compact = useCallback(async (): Promise<void> => {
    if (compacting.current) return;
    const current = session.current;
    if (!current) return;
    const plan = planCompaction(current);
    if (!plan) return;

    compacting.current = true;
    try {
      const body = current.summary
        ? `Summary so far:\n${current.summary}\n\nNewer exchanges to fold in:\n${transcriptOf({ ...current, turns: plan.fold })}`
        : transcriptOf({ ...current, turns: plan.fold });
      const summary = await complete(SUMMARIZE_TURNS, body);
      if (!summary || !session.current) return;
      session.current = applyCompaction(session.current, plan.foldCount, summary);
      await saveSession(session.current);
      callbacks.current.onIssue?.(`agent · compacted ${plan.foldCount} turns`);
    } finally {
      compacting.current = false;
    }
  }, [complete]);

  /**
   * Send the utterance to the model and resolve with its reply. Resolves with
   * exactly one outcome; the round's own epoch guard in useEcho handles a
   * superseded answer, so this doesn't need to.
   */
  const ask = useCallback(
    async (text: string): Promise<AskResult> => {
      const cfg = config.current;
      if (!cfg) return { kind: 'offline', message: "I don't have a brain configured right now." };

      const postedAt = Date.now();
      const asked = appendTurn(session.current ?? newSession(postedAt), { role: 'user', content: text }, postedAt);
      session.current = asked;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ASK_TIMEOUT_MS);
      let usage: ChatUsage | null = null;
      try {
        const messages: RequestMessage[] = buildRequest(PERSONA, memories.current, asked);
        let raw = '';
        for (let step = 0; step < MAX_STEPS; step++) {
          const res = await chat({
            apiKey: cfg.apiKey,
            model: cfg.model,
            messages,
            tools: TOOLS,
            signal: controller.signal,
            maxTokens: MAX_REPLY_TOKENS,
          });
          // Usage is per-call; the last one is the round's headline number.
          usage = res.usage ?? usage;
          if (!res.toolCalls.length) {
            raw = res.text;
            break;
          }
          messages.push(res.message);
          for (const call of res.toolCalls) messages.push(await runTool(call));
        }

        const replyAt = Date.now();
        if (usage) callbacks.current.onUsage?.(`agent · ${formatUsage(usage)}`);
        if (!raw) return { kind: 'error', message: 'agent · empty reply' };

        session.current = appendTurn(session.current ?? asked, { role: 'assistant', content: raw }, replyAt);
        await saveSession(session.current);
        // After the answer is on its way to the speaker, never before it.
        void compact();

        return { kind: 'reply', raw, speakable: speakableFromMrkdwn(raw), postedAt, replyAt };
      } catch (e) {
        if (controller.signal.aborted) return { kind: 'timeout', postedAt };
        return { kind: 'error', message: `agent · ${e instanceof Error ? e.message : String(e)}` };
      } finally {
        clearTimeout(timer);
      }
    },
    [compact],
  );

  /**
   * Close out the conversation now instead of waiting for the gap. Exposed for
   * the dev overlay: it is the only way to exercise the archive-and-summarize
   * path without sitting still for thirty minutes.
   */
  const endSession = useCallback(async (): Promise<void> => {
    const closing = session.current;
    const now = Date.now();
    session.current = newSession(now);
    await saveSession(session.current);
    if (!closing || closing.turns.length === 0) {
      callbacks.current.onIssue?.('agent · nothing to end');
      return;
    }
    await archive(closing, now);
  }, [archive]);

  return { status, model, ask, endSession };
}
