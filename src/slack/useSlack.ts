// The device's live Slack presence: owns the Socket Mode connection, pairing,
// and the ask-Eva round trip. Owned by FaceScreen, mirroring useWakeWord.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { authTest, connectionsOpen, postMessage } from './api';
import { clearSlackConfig, DEFAULT_EVA_USER_ID, getSlackConfig, setSlackConfig, SlackConfig } from './config';
import { isEvaReply, isSelf, type AskResult, type MessageEvent } from './protocol';
import { speakableFromMrkdwn } from './sanitize';
import { SlackSocket } from './socket';

export const ASK_TIMEOUT_MS = 45_000;

export type SlackStatus = 'unpaired' | 'disconnected' | 'connecting' | 'connected';

export interface PairingInput {
  botToken: string;
  appToken: string;
  channelId: string;
}

export interface UseSlackOptions {
  /** Channel/Eva message that didn't answer a pending ask — transcript only. */
  onUnsolicited?: (ev: MessageEvent) => void;
}

interface PendingAsk {
  askTs: string;
  postedAt: number;
  resolve: (r: AskResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function useSlack({ onUnsolicited }: UseSlackOptions = {}) {
  const [status, setStatus] = useState<SlackStatus>('unpaired');
  const statusRef = useRef<SlackStatus>('unpaired');
  const config = useRef<SlackConfig | null>(null);
  const socket = useRef<SlackSocket | null>(null);
  const pending = useRef<PendingAsk | null>(null);
  const callbacks = useRef({ onUnsolicited });
  callbacks.current = { onUnsolicited };

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

  const handleEvent = useCallback(
    (ev: MessageEvent) => {
      const cfg = config.current;
      if (!cfg || ev.channel !== cfg.channelId) return;
      if (isSelf(ev, cfg.botUserId)) return;
      const p = pending.current;
      if (p && isEvaReply(ev, { channelId: cfg.channelId, evaUserId: cfg.evaUserId, askTs: p.askTs })) {
        const raw = ev.text ?? '';
        settlePending({
          kind: 'reply',
          raw,
          speakable: speakableFromMrkdwn(raw),
          postedAt: p.postedAt,
          replyAt: Date.now(),
        });
        return;
      }
      if (ev.text && !ev.subtype) callbacks.current.onUnsolicited?.(ev);
    },
    [settlePending],
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

  useEffect(() => {
    let alive = true;
    void getSlackConfig().then((cfg) => {
      if (!alive || !cfg) return;
      config.current = cfg;
      startSocket(cfg);
    });
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

  /** Validate tokens, persist, connect. Returns a human-readable error or null. */
  const pair = useCallback(
    async (input: PairingInput): Promise<string | null> => {
      try {
        const { botUserId } = await authTest(input.botToken);
        const cfg: SlackConfig = { ...input, evaUserId: DEFAULT_EVA_USER_ID, botUserId };
        await setSlackConfig(cfg);
        config.current = cfg;
        startSocket(cfg);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
    [startSocket],
  );

  const unpair = useCallback(() => {
    settlePending({ kind: 'offline' });
    socket.current?.stop();
    socket.current = null;
    config.current = null;
    void clearSlackConfig();
    publish('unpaired');
  }, [publish, settlePending]);

  const reconnect = useCallback(() => {
    void socket.current?.reconnectNow();
  }, []);

  /**
   * Post the utterance to Eva and wait for her next message in the channel.
   * Resolves with exactly one outcome; a newer ask supersedes an older one.
   */
  const ask = useCallback(
    async (text: string): Promise<AskResult> => {
      const cfg = config.current;
      if (!cfg || statusRef.current !== 'connected') return { kind: 'offline' };
      settlePending({ kind: 'error', message: 'superseded by a newer ask' });
      let askTs: string;
      try {
        ({ ts: askTs } = await postMessage(cfg.botToken, cfg.channelId, `<@${cfg.evaUserId}> ${text}`));
      } catch (e) {
        return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
      }
      const postedAt = Date.now();
      return new Promise<AskResult>((resolve) => {
        pending.current = {
          askTs,
          postedAt,
          resolve,
          timer: setTimeout(() => {
            pending.current = null;
            resolve({ kind: 'timeout', postedAt });
          }, ASK_TIMEOUT_MS),
        };
      });
    },
    [settlePending],
  );

  return { status, ask, pair, unpair, reconnect };
}
