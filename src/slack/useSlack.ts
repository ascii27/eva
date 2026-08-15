// The device's live Slack presence: owns the Socket Mode connection, pairing,
// and the ask-Eva round trip. Owned by FaceScreen, mirroring useWakeWord.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { authTest, connectionsOpen, postMessage } from './api';
import {
  clearSlackConfig,
  DEFAULT_EVA_USER_ID,
  envSlackInput,
  getSlackConfig,
  setSlackConfig,
  SlackConfig,
} from './config';
import type { AskResult } from '../round/ask';
import { speakableFromMrkdwn } from '../round/speakable';
import { isEvaReply, isSelf, type MessageEvent } from './protocol';
import { isToolEcho, toolLabelFromEcho } from './sanitize';
import { SlackSocket } from './socket';

// Sized to Eva's observed real-world latency (50s+ when cold) — retune down
// once her side answers the voice surface faster.
export const ASK_TIMEOUT_MS = 90_000;

export type SlackStatus = 'unpaired' | 'disconnected' | 'connecting' | 'connected';

export interface PairingInput {
  botToken: string;
  appToken: string;
  channelId: string;
}

export interface UseSlackOptions {
  /**
   * Every message Eva posts in the channel, with whether it settled a pending
   * ask. Fired either way: proactive thread adoption has to see her replies
   * too, or a live back-and-forth would look like thread silence.
   */
  onEvaMessage?: (ev: MessageEvent, settledAnAsk: boolean) => void;
  /** Human-readable failures (env pairing, token problems…). */
  onIssue?: (message: string) => void;
  /** Tool-echo activity seen while an ask is pending (label from toolLabelFromEcho). */
  onToolActivity?: (label: string) => void;
}

interface PendingAsk {
  askTs: string;
  askThreadTs?: string;
  postedAt: number;
  resolve: (r: AskResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function useSlack({ onEvaMessage, onIssue, onToolActivity }: UseSlackOptions = {}) {
  const [status, setStatus] = useState<SlackStatus>('unpaired');
  const [botUserId, setBotUserId] = useState<string | null>(null);
  const statusRef = useRef<SlackStatus>('unpaired');
  const config = useRef<SlackConfig | null>(null);
  const socket = useRef<SlackSocket | null>(null);
  const pending = useRef<PendingAsk | null>(null);
  const callbacks = useRef({ onEvaMessage, onIssue, onToolActivity });
  callbacks.current = { onEvaMessage, onIssue, onToolActivity };

  const publish = useCallback((s: SlackStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const settlePending = useCallback((result: AskResult) => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    clearTimeout(p.timer);
    p.resolve(result);
  }, []);

  // Channel events seen while an ask's chat.postMessage HTTP call is still in
  // flight — a fast Eva reply can beat the post's response, so ask() replays
  // this buffer once it knows its own ts.
  const recentEvents = useRef<MessageEvent[]>([]);

  const settleIfReply = useCallback(
    (ev: MessageEvent): boolean => {
      const cfg = config.current;
      const p = pending.current;
      if (!cfg || !p) return false;
      const ctx = {
        channelId: cfg.channelId,
        evaUserId: cfg.evaUserId,
        askTs: p.askTs,
        askThreadTs: p.askThreadTs,
      };
      if (!isEvaReply(ev, ctx)) return false;
      const raw = ev.text ?? '';
      // Terminal echoes and other tool noise precede Eva's real answer —
      // surface them as activity, let them fall through to the transcript,
      // and keep waiting.
      if (isToolEcho(raw)) {
        callbacks.current.onToolActivity?.(toolLabelFromEcho(raw) ?? 'tool');
        return false;
      }
      settlePending({
        kind: 'reply',
        raw,
        speakable: speakableFromMrkdwn(raw),
        postedAt: p.postedAt,
        replyAt: Date.now(),
      });
      return true;
    },
    [settlePending],
  );

  const handleEvent = useCallback(
    (ev: MessageEvent) => {
      const cfg = config.current;
      if (!cfg || ev.channel !== cfg.channelId) return;
      if (isSelf(ev, cfg.botUserId)) return;
      recentEvents.current = [...recentEvents.current.slice(-9), ev];
      const settled = settleIfReply(ev);
      // Only Eva's own words reach the transcript as hers.
      if (ev.user === cfg.evaUserId && ev.text && !ev.subtype) callbacks.current.onEvaMessage?.(ev, settled);
    },
    [settleIfReply],
  );

  const startSocket = useCallback(
    (cfg: SlackConfig) => {
      socket.current?.stop();
      socket.current = new SlackSocket({
        getUrl: () => connectionsOpen(cfg.appToken),
        onEvent: handleEvent,
        onStatus: (s) => publish(s),
      });
      void socket.current.start();
    },
    [handleEvent, publish],
  );

  /** Validate both tokens, persist, connect. Returns a human-readable error or null. */
  const pair = useCallback(
    async (input: PairingInput): Promise<string | null> => {
      try {
        const { botUserId } = await authTest(input.botToken);
        // Exercise the app token too — the socket's retry loop swallows
        // connectionsOpen failures, so a bad xapp must be caught right here.
        await connectionsOpen(input.appToken);
        const cfg: SlackConfig = { ...input, evaUserId: DEFAULT_EVA_USER_ID, botUserId };
        await setSlackConfig(cfg);
        config.current = cfg;
        setBotUserId(botUserId);
        startSocket(cfg);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
    [startSocket],
  );

  useEffect(() => {
    let alive = true;
    // Token precedence: .env.local wins (the current dev workflow — editing
    // tokens on a phone keyboard is miserable), stored pairing is the fallback.
    const env = envSlackInput();
    if (env) {
      void pair(env).then((problem) => {
        if (alive && problem) callbacks.current.onIssue?.(`Slack env pairing: ${problem}`);
      });
    } else {
      void getSlackConfig().then((cfg) => {
        if (!alive || !cfg) return;
        config.current = cfg;
        setBotUserId(cfg.botUserId);
        startSocket(cfg);
      });
    }
    return () => {
      alive = false;
      socket.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The app is keep-awake and foregrounded by design, but if it ever does
  // background (Springboard slips, dev reloads), nudge the link on return.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && statusRef.current === 'disconnected') void socket.current?.reconnectNow();
    });
    return () => sub.remove();
  }, []);

  const unpair = useCallback(() => {
    settlePending({ kind: 'offline' });
    socket.current?.stop();
    socket.current = null;
    config.current = null;
    setBotUserId(null);
    void clearSlackConfig();
    publish('unpaired');
  }, [publish, settlePending]);

  const reconnect = useCallback(() => {
    void socket.current?.reconnectNow();
  }, []);

  /**
   * Post the utterance to Eva and wait for her next message in the channel.
   * Resolves with exactly one outcome; a newer ask supersedes an older one.
   * `threadTs` answers inside a thread Eva started, instead of at channel level.
   */
  const ask = useCallback(
    async (text: string, threadTs?: string): Promise<AskResult> => {
      const cfg = config.current;
      // Posting rides HTTPS, not the socket, so a briefly-'connecting' link
      // (Slack's routine graceful refreshes) must not drop the question.
      if (!cfg || statusRef.current === 'unpaired' || statusRef.current === 'disconnected') {
        // Being spoken to is the strongest liveness signal there is — skip
        // whatever backoff is pending and dial right now.
        if (statusRef.current === 'disconnected') void socket.current?.reconnectNow();
        return { kind: 'offline' };
      }
      settlePending({ kind: 'error', message: 'superseded by a newer ask' });
      let askTs: string;
      try {
        ({ ts: askTs } = await postMessage(cfg.botToken, cfg.channelId, `<@${cfg.evaUserId}> ${text}`, threadTs));
      } catch (e) {
        return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
      }
      const postedAt = Date.now();
      return new Promise<AskResult>((resolve) => {
        pending.current = {
          askTs,
          askThreadTs: threadTs,
          postedAt,
          resolve,
          timer: setTimeout(() => {
            pending.current = null;
            resolve({ kind: 'timeout', postedAt });
          }, ASK_TIMEOUT_MS),
        };
        // A fast reply may have arrived while postMessage was in flight. It was
        // announced as unsettled back then, so re-announce it as settled —
        // otherwise a listener holding it (the proactive queue) speaks it twice.
        for (const ev of recentEvents.current) {
          if (settleIfReply(ev)) {
            callbacks.current.onEvaMessage?.(ev, true);
            break;
          }
        }
      });
    },
    [settleIfReply, settlePending],
  );

  return { status, botUserId, ask, pair, unpair, reconnect };
}
