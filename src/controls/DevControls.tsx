import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { EYE_COLORS } from '../face/constants';
import { hexToRgba } from '../face/geometry';
import type { FaceMode, MouthOutput } from '../face/types';
import { VIS, VISEME_KEYS, VisemeKey } from '../face/visemes';

const MODES: Array<{ id: FaceMode; label: string; trigger: string }> = [
  { id: 'idle', label: 'Idle', trigger: 'default' },
  { id: 'listening', label: 'Listening', trigger: 'wake word' },
  { id: 'thinking', label: 'Thinking', trigger: 'sent' },
  { id: 'speaking', label: 'Speaking', trigger: 'tts' },
  { id: 'alert', label: 'Alert', trigger: 'eva init' },
  { id: 'confused', label: 'Confused', trigger: 'low conf' },
  { id: 'pleased', label: 'Pleased', trigger: 'done' },
];

interface DevControlsProps {
  mode: FaceMode;
  output: MouthOutput;
  colOn: boolean;
  eyeColor: string;
  frozen: VisemeKey | null;
  onMode: (m: FaceMode) => void;
  onBlink: () => void;
  onYawn: () => void;
  onOutput: (o: MouthOutput) => void;
  onToggleCol: () => void;
  onColor: (c: string) => void;
  onFreeze: (v: VisemeKey | null) => void;
  onSpeakTest: () => void;
  onListen: () => void;
  onClose: () => void;
}

export function DevControls(props: DevControlsProps) {
  const { eyeColor } = props;
  const activeStyle = {
    borderColor: hexToRgba(eyeColor, 0.5),
    backgroundColor: hexToRgba(eyeColor, 0.12),
  };

  const Btn = ({
    label,
    sub,
    active,
    onPress,
  }: {
    label: string;
    sub?: string;
    active?: boolean;
    onPress: () => void;
  }) => (
    <Pressable style={[styles.btn, active && activeStyle]} onPress={onPress}>
      <Text style={[styles.btnLabel, active && { color: eyeColor }]}>{label}</Text>
      {sub ? <Text style={styles.btnSub}>{sub}</Text> : null}
    </Pressable>
  );

  return (
    <View style={styles.root} pointerEvents="box-none">
      <View style={styles.panel}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.headerRow}>
            <Text style={styles.sectionLabel}>STATE VOCABULARY</Text>
            <Pressable onPress={props.onClose} hitSlop={12}>
              <Text style={styles.close}>CLOSE</Text>
            </Pressable>
          </View>
          {MODES.map((m) => (
            <Btn
              key={m.id}
              label={m.label}
              sub={m.trigger}
              active={props.mode === m.id}
              onPress={() => props.onMode(m.id)}
            />
          ))}

          <Text style={styles.sectionLabel}>BEHAVIORS</Text>
          <View style={styles.row}>
            <Btn label="Blink" onPress={props.onBlink} />
            <Btn label="Yawn" onPress={props.onYawn} />
          </View>

          <Text style={styles.sectionLabel}>MOUTH OUTPUT</Text>
          <View style={styles.row}>
            <Btn label="Lip sync" active={props.output === 'mouth'} onPress={() => props.onOutput('mouth')} />
            <Btn label="Waveform" active={props.output === 'wave'} onPress={() => props.onOutput('wave')} />
            <Btn label="Off" active={props.output === 'off'} onPress={() => props.onOutput('off')} />
          </View>

          <Text style={styles.sectionLabel}>LAYOUT</Text>
          <View style={styles.row}>
            <Btn label="Side column" active={props.colOn} onPress={props.onToggleCol} />
          </View>

          <Text style={styles.sectionLabel}>EYE COLOR</Text>
          <View style={styles.row}>
            {EYE_COLORS.map((c) => (
              <Pressable
                key={c}
                onPress={() => props.onColor(c)}
                style={[
                  styles.swatch,
                  { backgroundColor: c },
                  props.eyeColor === c && styles.swatchActive,
                ]}
              />
            ))}
          </View>

          <Text style={styles.sectionLabel}>PHONEME SET · TAP TO HOLD</Text>
          <View style={styles.wrapRow}>
            {VISEME_KEYS.map((k) => (
              <Pressable
                key={k}
                style={[styles.viseme, props.frozen === k && activeStyle]}
                onPress={() => props.onFreeze(props.frozen === k ? null : k)}
              >
                <Text style={[styles.visemeLabel, props.frozen === k && { color: eyeColor }]}>
                  {VIS[k].label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.sectionLabel}>SPEECH</Text>
          <View style={styles.row}>
            <Btn label="Speak test" onPress={props.onSpeakTest} />
            <Btn label="Listen" onPress={props.onListen} />
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  panel: {
    width: 300,
    backgroundColor: 'rgba(14,16,14,0.96)',
    borderLeftWidth: 1,
    borderLeftColor: '#2a2d2a',
  },
  scroll: {
    padding: 16,
    gap: 8,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  close: {
    fontFamily: 'JetBrainsMono_500Medium',
    fontSize: 10,
    letterSpacing: 1.2,
    color: '#a8ada8',
  },
  sectionLabel: {
    fontFamily: 'JetBrainsMono_500Medium',
    fontSize: 9,
    letterSpacing: 1.4,
    color: '#5c625c',
    marginTop: 10,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  wrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  btn: {
    flexGrow: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 11,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2d2a',
    backgroundColor: '#1b1d1b',
  },
  btnLabel: {
    fontFamily: 'SpaceGrotesk_500Medium',
    fontSize: 12,
    color: '#a8ada8',
  },
  btnSub: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 10,
    color: '#a8ada8',
    opacity: 0.5,
  },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchActive: {
    borderColor: '#e8ebe8',
  },
  viseme: {
    paddingVertical: 7,
    paddingHorizontal: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2d2a',
    backgroundColor: '#101210',
  },
  visemeLabel: {
    fontFamily: 'JetBrainsMono_500Medium',
    fontSize: 9,
    letterSpacing: 0.9,
    color: '#6f766f',
  },
});
