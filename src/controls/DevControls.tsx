import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { EYE_COLORS } from '../face/constants';
import { hexToRgba } from '../face/geometry';
import type { FaceMode, MouthOutput } from '../face/types';
import { VIS, VISEME_KEYS, VisemeKey } from '../face/visemes';
import type { SlackStatus } from '../slack/useSlack';
import type { WakeStatus } from '../speech/useWakeWord';
import type { WakeEvent } from '../speech/wakeLog';
import { hhmm } from '../util/time';

const WAKE_LOG_SHOWN = 30;

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
  convEnabled: boolean;
  onToggleConv: () => void;
  asidesEnabled: boolean;
  onToggleAsides: () => void;
  proactiveEnabled: boolean;
  onToggleProactive: () => void;
  /** Queue a canned Eva-initiated line — exercises the push path without Slack. */
  onProactiveTest: () => void;
  /** One-line TTS engine status, e.g. "kokoro ready" or "system voice". */
  ttsEngine: string;
  onClose: () => void;
  wakeEnabled: boolean;
  wakeStatus: WakeStatus;
  wakeEvents: WakeEvent[];
  onToggleWake: () => void;
  onClearWakeLog: () => void;
  slackStatus: SlackStatus;
  onSlackPair: () => void;
  onSlackReconnect: () => void;
  /** Typed question → full Eva round trip (the simulator path — no STT needed). */
  onAsk: (text: string) => void;
  /** Which brain answers: the local agent loop, or the remote Eva over Slack. */
  brain: 'local' | 'realtime' | 'slack';
  onToggleBrain: () => void;
  /** Live socket state on the realtime brain; null on the other two. */
  realtimeConnection: 'closed' | 'connecting' | 'open' | null;
  /** Active local model id, or why there isn't one. */
  agentModel: string;
  /** Close the conversation out to memory now, instead of after the 30min gap. */
  onEndSession: () => void;
  /** Delete every archived conversation and the live session. Irreversible. */
  onForgetAll: () => void;
  /** Whether the native camera modules loaded at all. */
  visionAvailable: boolean;
  /** Drive the consent gate end to end without the model. */
  onLookTest: () => void;
  /** Step to the next model in MODEL_PRESETS; takes effect on the next round. */
  onCycleModel: () => void;
  /** Bundle age and cost, or why there isn't one. */
  bundleLabel: string;
  onBundleRefresh: () => void;
  /** Errands out to hermes, or null when none is configured. */
  errandsInFlight: number | null;
}

export function DevControls(props: DevControlsProps) {
  const { eyeColor } = props;
  const [askText, setAskText] = useState('');
  // Forget-all is irreversible and sits next to buttons you press casually, so
  // it arms on the first tap and only fires on the second.
  const [forgetArmed, setForgetArmed] = useState(false);
  const submitAsk = () => {
    const text = askText.trim();
    if (!text) return;
    setAskText('');
    props.onAsk(text);
  };
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

          <Text style={styles.sectionLabel}>SPEECH · {props.ttsEngine}</Text>
          <View style={styles.row}>
            <Btn label="Speak test" onPress={props.onSpeakTest} />
            <Btn label="Listen" onPress={props.onListen} />
            <Btn label="Conversation" sub="follow-ups" active={props.convEnabled} onPress={props.onToggleConv} />
            <Btn label="Asides" sub="thinking" active={props.asidesEnabled} onPress={props.onToggleAsides} />
            <Btn
              label="Proactive"
              sub="eva speaks first"
              active={props.proactiveEnabled}
              onPress={props.onToggleProactive}
            />
            <Btn label="Proactive test" onPress={props.onProactiveTest} />
          </View>

          <Text style={styles.sectionLabel}>
            BRAIN · {props.brain === 'slack' ? 'slack' : props.agentModel}
          </Text>
          <View style={styles.row}>
            <Btn
              label={props.brain === 'local' ? 'Local' : props.brain === 'realtime' ? 'Realtime' : 'Slack'}
              sub="tap to switch"
              active={props.brain !== 'slack'}
              onPress={props.onToggleBrain}
            />
            <Btn label="End session" sub="→ memory" onPress={props.onEndSession} />
          </View>
          {/* Whether the socket is up, and so whether the next question pays a
              handshake. A round that fails with nothing to show for it looks
              the same as one that was never asked; this is the difference. */}
          {props.realtimeConnection !== null && (
            <Text style={styles.note}>
              {props.realtimeConnection === 'open'
                ? 'socket open — the next question skips the handshake'
                : props.realtimeConnection === 'connecting'
                  ? 'socket dialling'
                  : 'socket closed — dials on the next wake'}
            </Text>
          )}
          {/* One button per row from here down: styles.row does not wrap and
              the panel is a fixed 300px, so a third button beside the pair
              above is squeezed to nothing. */}
          <View style={styles.row}>
            <Btn label="Model" sub={props.agentModel} onPress={props.onCycleModel} />
          </View>
          <View style={styles.row}>
            {/* What hermes last sent down, and how old it is. Worth a button:
                "she doesn't know about the two o'clock" looks identical whether
                the bundle is stale, unparseable, or was never fetched at all. */}
            <Btn label="Bundle" sub={props.bundleLabel} onPress={props.onBundleRefresh} />
          </View>
          {props.errandsInFlight !== null && (
            <Text style={styles.note}>
              {props.errandsInFlight === 0
                ? 'no errands out'
                : `${props.errandsInFlight} errand${props.errandsInFlight === 1 ? '' : 's'} out to hermes`}
            </Text>
          )}
          <View style={styles.row}>
            <Btn
              label={forgetArmed ? 'Wipe everything?' : 'Forget all'}
              sub={forgetArmed ? 'tap again' : 'session + memory'}
              active={forgetArmed}
              onPress={() => {
                if (!forgetArmed) {
                  setForgetArmed(true);
                  return;
                }
                setForgetArmed(false);
                props.onForgetAll();
              }}
            />
          </View>
          <View style={styles.row}>
            <TextInput
              style={styles.askInput}
              value={askText}
              onChangeText={setAskText}
              placeholder="type a question for Eva"
              placeholderTextColor="#4e5a54"
              autoCapitalize="none"
              onSubmitEditing={submitAsk}
              returnKeyType="send"
            />
            <Btn label="Ask" onPress={submitAsk} />
          </View>

          <Text style={styles.sectionLabel}>VISION · {props.visionAvailable ? 'camera' : 'none'}</Text>
          {/* Runs the whole consent gate — question, mic, shutter, thumbnail —
              without going near the model, which is the only way to exercise
              it when the model declines to reach for the camera. */}
          <View style={styles.row}>
            <Btn label="Look" sub="asks first" onPress={props.onLookTest} />
          </View>

          <Text style={styles.sectionLabel}>SLACK</Text>
          <View style={styles.row}>
            <Btn label="Pair" sub={props.slackStatus} onPress={props.onSlackPair} />
            <Btn label="Reconnect" onPress={props.onSlackReconnect} />
          </View>

          <Text style={styles.sectionLabel}>WAKE WORD</Text>
          <Btn
            label="Wake watching"
            sub={props.wakeStatus}
            active={props.wakeEnabled}
            onPress={props.onToggleWake}
          />
          <View style={styles.headerRow}>
            <Text style={styles.sectionLabel}>WAKE LOG · {props.wakeEvents.length}</Text>
            <Pressable onPress={props.onClearWakeLog} hitSlop={12}>
              <Text style={styles.close}>CLEAR</Text>
            </Pressable>
          </View>
          {props.wakeEvents.slice(-WAKE_LOG_SHOWN).map((e, i) => (
            <Text key={`${e.ts}-${i}`} style={styles.wakeLine} numberOfLines={1}>
              {hhmm(e.ts)} · {e.snippet}
            </Text>
          ))}
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
  /** A read-only line under a row — status, not an affordance. */
  note: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 9,
    letterSpacing: 0.6,
    color: '#5c625c',
    marginTop: 6,
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
  wakeLine: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 10,
    lineHeight: 16,
    color: '#6f766f',
  },
  askInput: {
    flexGrow: 1,
    flexShrink: 1,
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 11,
    color: '#d6efe4',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2d2a',
    backgroundColor: '#101210',
  },
});
