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
import { DevControls } from '../controls/DevControls';
import { SlackPairing } from '../controls/SlackPairing';
import { speakableFromMrkdwn } from '../slack/sanitize';
import { useSlack, type SlackStatus } from '../slack/useSlack';
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
const WAKE_ENABLED_KEY = 'eva.wakeEnabled.v1';

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

  const slack = useSlack({
    // Eva messages that didn't answer a pending ask: transcript only, never
    // spoken — the alert surfacing rules are Phase 4.
    onUnsolicited: (ev) => log(`eva · ${speakableFromMrkdwn(ev.text ?? '')}`),
  });

  const echo = useEcho({
    setMode,
    onHeard: (text) => log(`heard · ${text}`),
    onSaid: (text) => {
      setLastSaid(text);
      log(`said · ${text}`);
    },
    onIssue: (message) => log(message),
    ask: slack.status === 'unpaired' ? undefined : slack.ask,
    onLatency: (line) => {
      log(line);
      console.log(`[latency] ${line}`);
    },
  });

  // Connection breadcrumbs on transitions only — retries stay quiet.
  const prevSlackStatus = useRef<SlackStatus | null>(null);
  useEffect(() => {
    const prev = prevSlackStatus.current;
    prevSlackStatus.current = slack.status;
    if (prev === null || slack.status === 'connecting') return;
    if (slack.status === 'connected') log('slack · connected');
    else if (slack.status === 'disconnected') log('slack · offline (retrying)');
    else log('slack · unpaired');
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
    if (mode === 'idle') setEchoBusy(false);
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

  const onWake = useCallback(
    (snippet: string) => {
      log(`wake · ${snippet}`);
      startRound(() => void echoRef.current.listen(Date.now()));
      // Count refresh is cosmetic; skip the storage read unless the overlay
      // is showing (it re-reads on every open anyway).
      if (devVisibleRef.current) void getWakeEvents().then(setWakeEvents);
    },
    [log, startRound],
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
    const id = setTimeout(() => echo.say(SPEAK_TEST_LINE), 4000);
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
          onSpeakTest={() => {
            echo.cancel();
            startRound(() => echo.say(SPEAK_TEST_LINE));
          }}
          onListen={() => {
            echo.cancel();
            startRound(() => void echo.listen());
          }}
          onClose={() => setDevVisible(false)}
          wakeEnabled={wakeEnabled}
          wakeStatus={wake.status}
          wakeEvents={wakeEvents}
          onToggleWake={toggleWake}
          onClearWakeLog={() => {
            void clearWakeEvents().then(() => setWakeEvents([]));
          }}
          slackStatus={slack.status}
          onSlackPair={() => setPairingVisible(true)}
          onSlackReconnect={slack.reconnect}
          onAsk={(text) => {
            echo.cancel();
            log(`asked · ${text}`);
            startRound(() => echo.ask(text));
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
