import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
} from '@expo-google-fonts/jetbrains-mono';
import {
  SpaceGrotesk_400Regular,
  SpaceGrotesk_500Medium,
} from '@expo-google-fonts/space-grotesk';
import { useFonts } from 'expo-font';
import React, { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { DevControls } from '../controls/DevControls';
import { useEcho } from '../speech/useEcho';
import { DEFAULT_EYE_COLOR, DESIGN_H, DESIGN_W, SIDE_COLUMN_W } from './constants';
import { Face } from './Face';
import { SideColumn, TranscriptEntry } from './SideColumn';
import type { FaceMode, MouthOutput } from './types';
import type { VisemeKey } from './visemes';

const TRIPLE_TAP_WINDOW_MS = 800;
const SPEAK_TEST_LINE = 'The Q3 doc is filed under Platform Planning.';

function timeNow(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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

  const log = useCallback((text: string) => {
    setEntries((prev) => [...prev.slice(-19), { time: timeNow(), text }]);
  }, []);

  const echo = useEcho({
    setMode,
    onHeard: (text) => log(`heard · ${text}`),
    onSaid: (text) => {
      setLastSaid(text);
      log(`said · ${text}`);
    },
    onIssue: (message) => log(message),
  });

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
            echo.say(SPEAK_TEST_LINE);
          }}
          onListen={() => {
            echo.cancel();
            echo.listen();
          }}
          onClose={() => setDevVisible(false)}
        />
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
