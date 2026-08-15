import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
} from '@expo-google-fonts/jetbrains-mono';
import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
} from '@expo-google-fonts/space-grotesk';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFonts } from 'expo-font';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useAgent } from '../agent/useAgent';
import { DevControls } from '../controls/DevControls';
import { SlackPairing } from '../controls/SlackPairing';
import { speakableFromMrkdwn } from '../round/speakable';
import { useSlack, type SlackStatus } from '../slack/useSlack';
import { initKokoro, type TtsEngineState } from '../speech/kokoro';
import { FOLLOWUP_WINDOW_MS } from '../speech/conversation';
import {
  dequeue,
  dropTs,
  enqueue,
  receive,
  threadRoot,
  type Adoptions,
  type LiveExchange,
  type ProactiveItem,
} from '../speech/proactive';
import { useEcho } from '../speech/useEcho';
import { useWakeWord } from '../speech/useWakeWord';
import { clearWakeEvents, getWakeEvents, WakeEvent } from '../speech/wakeLog';
import { DEFAULT_EYE_COLOR, DESIGN_H, DESIGN_W, SIDE_COLUMN_W } from './constants';
import { Face } from './Face';
import { SideColumn, TranscriptEntry } from './SideColumn';
import type { FaceMode, MouthOutput } from './types';
import type { VisemeKey } from './visemes';
import { hhmm } from '../util/time';

const TRIPLE_TAP_WINDOW_MS = 800;
const SPEAK_TEST_LINE = 'The Q3 doc is filed under Platform Planning.';
const PROACTIVE_TEST_LINE = 'The two o’clock moved to one thirty.';
const WAKE_ENABLED_KEY = 'eva.wakeEnabled.v1';
const CONV_ENABLED_KEY = 'eva.convEnabled.v1';
const ASIDES_ENABLED_KEY = 'eva.asidesEnabled.v1';
const PROACTIVE_ENABLED_KEY = 'eva.proactiveEnabled.v1';
const BRAIN_LOCAL_KEY = 'eva.brainLocal.v1';

/**
 * Single source for the Kokoro engine's user-facing wording: the transcript
 * line (null = stay silent) and the dev-overlay engine label. Download
 * progress is coarsened to 10% steps so the ~330MB fetch doesn't flood the
 * transcript; the caller dedupes repeats.
 */
function describeTtsState(s: TtsEngineState): { line: string | null; label: string } {
  switch (s.state) {
    case 'downloading': {
      const pct = Math.floor(s.progress * 10) * 10;
      return { line: `tts · kokoro downloading ${pct}%`, label: `kokoro ${pct}%` };
    }
    case 'loading':
      return { line: 'tts · kokoro loading', label: 'kokoro loading' };
    case 'ready':
      return { line: 'tts · kokoro ready', label: 'kokoro ready' };
    case 'error':
      return { line: 'tts · kokoro failed — using system voice', label: 'system voice' };
    case 'unavailable':
      // Expo Go / simulator without the dev build: silence, system voice covers it.
      return { line: null, label: 'system voice' };
  }
}

export function FaceScreen() {
  const [fontsLoaded] = useFonts({
    SpaceGrotesk_400Regular,
    SpaceGrotesk_500Medium,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  });

  const { width, height } = useWindowDimensions();
  const k = Math.min(width / DESIGN_W, height / DESIGN_H);

  const [mode, setMode] = useState<FaceMode>('idle');
  const [output, setOutput] = useState<MouthOutput>('mouth');
  const [colOn, setColOn] = useState(true);
  const [eyeColor, setEyeColor] = useState<string>(DEFAULT_EYE_COLOR);
  const [frozen, setFrozen] = useState<VisemeKey | null>(null);
  const [lastSaid, setLastSaid] = useState<string | null>(null);
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [blinkNonce, setBlinkNonce] = useState(0);
  const [yawnNonce, setYawnNonce] = useState(0);
  const [devVisible, setDevVisible] = useState(false);
  const [pairingVisible, setPairingVisible] = useState(false);

  const log = useCallback((text: string) => {
    setEntries((prev) => [...prev.slice(-19), { time: hhmm(), text }]);
  }, []);

  // useSlack mounts before useEcho; the ref bridges tool activity to it.
  const noteToolRef = useRef<(label: string) => void>(() => {});

  // Proactive push. Eva @-mentions us to adopt a thread; her posts in it are
  // then spoken once the face is quiet. All refs — the drain is driven by
  // proactiveNonce instead, so a message arriving while Eva is *already* idle
  // still wakes the effect (nothing else about the render would change).
  const botUserIdRef = useRef<string | null>(null);
  const adoptions = useRef<Adoptions>({});
  const backlog = useRef<ProactiveItem[]>([]);
  const activeThread = useRef<string | null>(null);
  // The thread being talked through right now. Held open (until: null) for as
  // long as the face is busy, then given a grace period once it settles.
  const exchange = useRef<LiveExchange | null>(null);
  const [proactiveNonce, setProactiveNonce] = useState(0);

  const holdExchange = useCallback((threadTs: string) => {
    exchange.current = { threadTs, until: null };
  }, []);

  const pushProactive = useCallback(
    (item: ProactiveItem) => {
      const q = enqueue(backlog.current, item);
      backlog.current = q.queue;
      if (q.dropped) log('eva · dropped an older update (backlog full)');
      setProactiveNonce((n) => n + 1);
    },
    [log],
  );

  const slack = useSlack({
    onEvaMessage: (ev, settledAnAsk) => {
      // An answer already reaches the transcript as `said ·` when it's spoken.
      if (!settledAnAsk) log(`eva · ${speakableFromMrkdwn(ev.text ?? '')}`);
      const bot = botUserIdRef.current;
      if (!bot) return;
      // Fold every message, settled or not: an adopted thread's clock has to
      // stay fresh through ask replies and tool noise we'll never speak.
      const r = receive(ev, Date.now(), bot, adoptions.current, exchange.current);
      adoptions.current = r.adoptions;
      // A reply can reach us before its own ask registers, so this message may
      // already be queued as proactive — useEcho is about to speak it as the
      // round's answer, and it must not be spoken again.
      if (settledAnAsk) {
        backlog.current = dropTs(backlog.current, ev.ts);
        // Her answer is about to be spoken, so the thread is live from here.
        holdExchange(threadRoot(ev));
        return;
      }
      if (r.item) pushProactive(r.item);
    },
    onIssue: log,
    onToolActivity: (label) => noteToolRef.current(label),
  });
  botUserIdRef.current = slack.botUserId;

  // Continuous conversation: after a reply, keep listening for follow-ups
  // until the window lapses silently. Persisted, default on.
  const [convEnabled, setConvEnabled] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(CONV_ENABLED_KEY).then((v) => {
      if (v === '0') setConvEnabled(false);
    });
  }, []);

  const toggleConv = useCallback(() => {
    setConvEnabled((v) => {
      void AsyncStorage.setItem(CONV_ENABLED_KEY, v ? '0' : '1');
      return !v;
    });
  }, []);

  // Thinking asides: spoken fillers + tool narration during Eva's wait.
  // Persisted, default on.
  const [asidesEnabled, setAsidesEnabled] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(ASIDES_ENABLED_KEY).then((v) => {
      if (v === '0') setAsidesEnabled(false);
    });
  }, []);

  const toggleAsides = useCallback(() => {
    setAsidesEnabled((v) => {
      void AsyncStorage.setItem(ASIDES_ENABLED_KEY, v ? '0' : '1');
      return !v;
    });
  }, []);

  // Proactive push: speak Eva's unprompted messages. Off leaves them in the
  // transcript, as before. Persisted, default on.
  const [proactiveEnabled, setProactiveEnabled] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(PROACTIVE_ENABLED_KEY).then((v) => {
      if (v === '0') setProactiveEnabled(false);
    });
  }, []);

  const toggleProactive = useCallback(() => {
    setProactiveEnabled((v) => {
      void AsyncStorage.setItem(PROACTIVE_ENABLED_KEY, v ? '0' : '1');
      return !v;
    });
  }, []);

  // Which brain answers: the local agent loop (default) or the remote Eva over
  // Slack. Kept switchable so the two can be compared on the same device — and
  // because Slack is still the only route to Eva's real tools. Persisted.
  const [brainLocal, setBrainLocal] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(BRAIN_LOCAL_KEY).then((v) => {
      if (v === '0') setBrainLocal(false);
    });
  }, []);

  const toggleBrain = useCallback(() => {
    setBrainLocal((v) => {
      void AsyncStorage.setItem(BRAIN_LOCAL_KEY, v ? '0' : '1');
      return !v;
    });
  }, []);

  const agent = useAgent({ onIssue: log, onUsage: log });

  const echo = useEcho({
    setMode,
    onHeard: (text) => log(`heard · ${text}`),
    onSaid: (text) => {
      setLastSaid(text);
      log(`said · ${text}`);
    },
    onIssue: (message) => log(message),
    // Local brain answers directly. On the Slack brain, answers to a proactive
    // message go back into its thread; anything the user starts posts at
    // channel level, as before. Undefined (unpaired, no local key) is
    // load-bearing: it drops useEcho back to the Phase-1 echo.
    ask: brainLocal
      ? agent.status === 'unconfigured'
        ? undefined
        : agent.ask
      : slack.status === 'unpaired'
        ? undefined
        : (text: string) => slack.ask(text, activeThread.current ?? undefined),
    onLatency: (line) => {
      log(line);
      console.log(`[latency] ${line}`);
    },
    conversation: convEnabled,
    asides: asidesEnabled,
  });

  noteToolRef.current = echo.noteToolActivity;

  // Kokoro engine bring-up: one-time model download (first run) + load, with
  // transcript breadcrumbs.
  const [ttsState, setTtsState] = useState<TtsEngineState>({ state: 'unavailable' });
  const lastTtsLine = useRef<string | null>(null);
  useEffect(() => {
    void initKokoro((s) => {
      setTtsState(s);
      const { line } = describeTtsState(s);
      if (line && line !== lastTtsLine.current) {
        lastTtsLine.current = line;
        log(line);
      }
    });
  }, [log]);

  // Connection breadcrumbs: one line per up/down edge. Retry cycles bounce
  // between disconnected and connecting, so tracking the last *logged* edge —
  // not the last status — keeps an outage from flooding the transcript.
  const linkLogged = useRef<'up' | 'down' | null>(null);
  useEffect(() => {
    const s: SlackStatus = slack.status;
    if (s === 'connected' && linkLogged.current !== 'up') {
      linkLogged.current = 'up';
      log('slack · connected');
    } else if (s === 'disconnected' && linkLogged.current !== 'down') {
      linkLogged.current = 'down';
      log('slack · offline (retrying)');
    } else if (s === 'unpaired' && linkLogged.current !== null) {
      linkLogged.current = null;
      log('slack · unpaired');
    }
  }, [slack.status, log]);

  // Wake watching. `echoBusy` bridges the gap between claiming a round (the
  // recognizer isn't ours anymore) and the face actually leaving idle; it
  // clears when the round settles back to idle. Suspending on any non-idle
  // mode also keeps the watcher off while Eva speaks — she must never wake
  // on her own voice.
  const [wakeEnabled, setWakeEnabled] = useState(false);
  const [echoBusy, setEchoBusy] = useState(false);
  const [wakeEvents, setWakeEvents] = useState<WakeEvent[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(WAKE_ENABLED_KEY).then((v) => {
      if (v === '1') setWakeEnabled(true);
    });
  }, []);

  useEffect(() => {
    if (mode !== 'idle') return;
    setEchoBusy(false);
    // The exchange is off screen; give it a grace period covering the
    // follow-up window before its thread counts as quiet again.
    const live = exchange.current;
    if (live && live.until === null) exchange.current = { ...live, until: Date.now() + FOLLOWUP_WINDOW_MS };
  }, [mode]);

  const echoRef = useRef(echo);
  echoRef.current = echo;
  const devVisibleRef = useRef(false);

  // Every round starter — dev buttons, wake detections, and Phase 3's
  // Eva-initiated replies — must claim the round through here, so the wake
  // watcher stands down before useEcho's async ramp-up grabs the mic.
  const startRound = useCallback((begin: () => void) => {
    setEchoBusy(true);
    begin();
  }, []);

  /** Round starters the user drove: their questions belong at channel level. */
  const startUserRound = useCallback(
    (begin: () => void) => {
      activeThread.current = null;
      startRound(begin);
    },
    [startRound],
  );

  // Drain one backlogged message per genuinely quiet moment. Going through
  // startRound is what stands the wake watcher down before Eva speaks; the
  // face is still 'idle' at this point, so nothing else has claimed the mic.
  useEffect(() => {
    // Switched off, Eva's messages are transcript-only and nothing piles up —
    // switching it back on must not unleash everything said in the meantime.
    if (!proactiveEnabled) {
      backlog.current = [];
      return;
    }
    if (mode !== 'idle' || echoBusy) return;
    const d = dequeue(backlog.current);
    if (!d.item) return;
    backlog.current = d.queue;
    activeThread.current = d.item.threadTs;
    holdExchange(d.item.threadTs);
    const { text } = d.item;
    startRound(() => echoRef.current.announce(text));
  }, [mode, echoBusy, proactiveEnabled, proactiveNonce, holdExchange, startRound]);

  const onWake = useCallback(
    (snippet: string) => {
      log(`wake · ${snippet}`);
      startUserRound(() => void echoRef.current.listen(Date.now()));
      // Count refresh is cosmetic; skip the storage read unless the overlay
      // is showing (it re-reads on every open anyway).
      if (devVisibleRef.current) void getWakeEvents().then(setWakeEvents);
    },
    [log, startUserRound],
  );

  const wake = useWakeWord({
    enabled: wakeEnabled,
    suspended: echoBusy || mode !== 'idle',
    onWake,
    onIssue: log,
  });

  const toggleWake = useCallback(() => {
    setWakeEnabled((v) => {
      void AsyncStorage.setItem(WAKE_ENABLED_KEY, v ? '0' : '1');
      return !v;
    });
  }, []);

  // Manual mode picks abandon any in-flight speech round, like the design's pick().
  const pickMode = useCallback(
    (m: FaceMode) => {
      echo.cancel();
      setFrozen(null);
      setMode(m);
    },
    [echo],
  );

  // Headless TTS check: EXPO_PUBLIC_TTS_AUTOTEST=1 speaks the test line once
  // shortly after launch, so the pipeline can be exercised without touching
  // the screen (used when driving the simulator from the CLI).
  const autoTested = useRef(false);
  React.useEffect(() => {
    if (!process.env.EXPO_PUBLIC_TTS_AUTOTEST || autoTested.current) return;
    autoTested.current = true;
    // "1" keeps the classic 4s; a larger value is a delay in ms (e.g. 12000 to
    // let the Kokoro engine finish loading first and exercise that path).
    const delay = Math.max(4000, Number(process.env.EXPO_PUBLIC_TTS_AUTOTEST) || 0);
    const id = setTimeout(() => echo.say(SPEAK_TEST_LINE), delay);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Headless Slack round trip: EXPO_PUBLIC_ASK_AUTOTEST="question" asks Eva
  // once after launch (waits out env pairing + socket connect first).
  const askTested = useRef(false);
  React.useEffect(() => {
    const question = process.env.EXPO_PUBLIC_ASK_AUTOTEST;
    if (!question || askTested.current) return;
    askTested.current = true;
    const id = setTimeout(() => {
      log(`asked · ${question}`);
      startUserRound(() => echoRef.current.ask(question));
    }, 8000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    devVisibleRef.current = devVisible;
    if (devVisible) void getWakeEvents().then(setWakeEvents);
  }, [devVisible]);

  const taps = useRef<number[]>([]);
  const onHotspotTap = useCallback(() => {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < TRIPLE_TAP_WINDOW_MS), now];
    if (taps.current.length >= 3) {
      taps.current = [];
      setDevVisible((v) => !v);
    }
  }, []);

  const colW = colOn ? SIDE_COLUMN_W * k : 0;
  const faceW = width - colW;

  return (
    <View style={styles.root}>
      <Face
        mode={mode}
        eyeColor={eyeColor}
        output={output}
        frozen={frozen}
        width={faceW}
        height={height}
        k={k}
        blinkNonce={blinkNonce}
        yawnNonce={yawnNonce}
      />
      {colOn && fontsLoaded && (
        <SideColumn
          mode={mode}
          eyeColor={eyeColor}
          k={k}
          width={colW}
          lastSaid={lastSaid}
          entries={entries}
          watching={wake.status === 'watching'}
          connection={slack.status}
        />
      )}

      <Pressable style={styles.hotspot} onPress={onHotspotTap} />

      {devVisible && fontsLoaded && (
        <DevControls
          mode={mode}
          output={output}
          colOn={colOn}
          eyeColor={eyeColor}
          frozen={frozen}
          onMode={pickMode}
          onBlink={() => {
            pickMode('idle');
            setBlinkNonce((n) => n + 1);
          }}
          onYawn={() => {
            pickMode('idle');
            setYawnNonce((n) => n + 1);
          }}
          onOutput={setOutput}
          onToggleCol={() => setColOn((v) => !v)}
          onColor={setEyeColor}
          onFreeze={(v) => {
            setFrozen(v);
            if (v) setOutput('mouth');
          }}
          ttsEngine={describeTtsState(ttsState).label}
          onSpeakTest={() => {
            echo.cancel();
            startUserRound(() => echo.say(SPEAK_TEST_LINE));
          }}
          onListen={() => {
            echo.cancel();
            startUserRound(() => void echo.listen());
          }}
          convEnabled={convEnabled}
          onToggleConv={toggleConv}
          asidesEnabled={asidesEnabled}
          onToggleAsides={toggleAsides}
          proactiveEnabled={proactiveEnabled}
          onToggleProactive={toggleProactive}
          onProactiveTest={() => {
            const at = Date.now();
            log(`eva · ${PROACTIVE_TEST_LINE}`);
            pushProactive({ ts: `test.${at}`, threadTs: `test.${at}`, text: PROACTIVE_TEST_LINE, at });
          }}
          onClose={() => setDevVisible(false)}
          wakeEnabled={wakeEnabled}
          wakeStatus={wake.status}
          wakeEvents={wakeEvents}
          onToggleWake={toggleWake}
          onClearWakeLog={() => {
            void clearWakeEvents().then(() => setWakeEvents([]));
          }}
          brainLocal={brainLocal}
          onToggleBrain={toggleBrain}
          agentModel={agent.model ?? 'no key'}
          onEndSession={() => void agent.endSession()}
          onForgetAll={() => void agent.forgetAll()}
          slackStatus={slack.status}
          onSlackPair={() => setPairingVisible(true)}
          onSlackReconnect={slack.reconnect}
          onAsk={(text) => {
            echo.cancel();
            log(`asked · ${text}`);
            startUserRound(() => echo.ask(text));
          }}
        />
      )}

      {pairingVisible && fontsLoaded && (
        <SlackPairing onPair={slack.pair} onForget={slack.unpair} onClose={() => setPairingVisible(false)} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#000',
  },
  hotspot: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 90,
    height: 90,
  },
});
