import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { hexToRgba } from './geometry';
import type { FaceMode } from './types';
import type { SlackStatus } from '../slack/useSlack';
import { CameraPreview } from '../vision/CameraPreview';
import type { CameraHandle } from '../vision/camera';
import { hhmm } from '../util/time';

/** Per-mode "Last said" placeholder, from the design; real utterances override. */
export const SAID: Record<FaceMode, string> = {
  idle: 'Nothing pending. Two things queued for the morning.',
  listening: '…',
  thinking: '…',
  speaking: 'The Q3 doc is filed under Platform Planning.',
  alert: 'The 2pm moved to 1:30.',
  confused: "I didn't catch that.",
  pleased: 'Done — filed and linked.',
};

export interface TranscriptEntry {
  time: string;
  text: string;
}

/**
 * The camera slot. Viewfinder while a consent gate is open, then the frame it
 * captured — one slot, so the preview visibly becomes the photo.
 */
export interface VisionProps {
  previewing: boolean;
  thumbnailUri: string | null;
  onCameraReady: (camera: CameraHandle | null) => void;
}

/** Design-unit size of the camera slot; fits the gap above TRANSCRIPT. */
const CAM_W = 202;
const CAM_H = 152;

interface SideColumnProps {
  mode: FaceMode;
  eyeColor: string;
  k: number;
  width: number;
  lastSaid: string | null;
  entries: TranscriptEntry[];
  /** Wake watching is live — shown while the face is otherwise idle. */
  watching?: boolean;
  /** Real Slack link state — drives the label and dot. */
  connection: SlackStatus;
  /** Absent on a build with no camera, which renders no slot at all. */
  vision?: VisionProps;
}

export function SideColumn({
  mode,
  eyeColor,
  k,
  width,
  lastSaid,
  entries,
  watching,
  connection,
  vision,
}: SideColumnProps) {
  const connLabel =
    mode === 'alert'
      ? 'Eva · initiating'
      : connection === 'connected'
        ? watching && mode === 'idle'
          ? 'Eva · watching'
          : 'Eva · connected'
        : connection === 'connecting'
          ? 'Eva · connecting'
          : connection === 'disconnected'
            ? 'Eva · offline'
            : 'Eva · not paired';
  const dotLive = connection === 'connected';
  return (
    <View style={[styles.root, { width, padding: 24 * k, paddingVertical: 26 * k }]}>
      <LinearGradient
        colors={[hexToRgba(eyeColor, 0), hexToRgba(eyeColor, 0.04)]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.connRow, { gap: 8 * k }]}>
        <View
          style={{
            width: 6 * k,
            height: 6 * k,
            borderRadius: 3 * k,
            backgroundColor: dotLive ? eyeColor : '#4e5a54',
            shadowColor: dotLive ? eyeColor : 'transparent',
            shadowOpacity: dotLive ? 0.7 : 0,
            shadowRadius: 4 * k,
            shadowOffset: { width: 0, height: 0 },
          }}
        />
        <Text style={[styles.connLabel, { fontSize: 10 * k, letterSpacing: 1.4 * k }]}>
          {connLabel.toUpperCase()}
        </Text>
      </View>

      <View style={{ gap: 7 * k, marginTop: 20 * k }}>
        <Text style={[styles.sectionLabel, { fontSize: 9 * k, letterSpacing: 1.26 * k }]}>LAST SAID</Text>
        <Text style={[styles.lastSaid, { fontSize: 14 * k, lineHeight: 21 * k }]}>
          {lastSaid ?? SAID[mode]}
        </Text>
      </View>

      {vision && (vision.previewing || vision.thumbnailUri) && (
        <View style={{ gap: 6 * k, marginTop: 16 * k }}>
          <Text style={[styles.sectionLabel, { fontSize: 9 * k, letterSpacing: 1.26 * k }]}>
            {vision.previewing ? 'LOOKING' : 'SAW'}
          </Text>
          {vision.previewing ? (
            <CameraPreview
              onReady={vision.onCameraReady}
              eyeColor={eyeColor}
              k={k}
              width={CAM_W * k}
              height={CAM_H * k}
            />
          ) : (
            <Image
              source={{ uri: vision.thumbnailUri! }}
              style={{
                width: CAM_W * k,
                height: CAM_H * k,
                borderRadius: 6 * k,
                borderWidth: 1,
                borderColor: `${eyeColor}33`,
              }}
              resizeMode="cover"
            />
          )}
        </View>
      )}

      <View style={{ marginTop: 'auto', gap: 6 * k }}>
        <Text style={[styles.sectionLabel, { fontSize: 9 * k, letterSpacing: 1.26 * k }]}>TRANSCRIPT</Text>
        {entries.slice(-4).map((e, i, all) => (
          <Text
            key={i}
            style={[styles.logLine, { fontSize: 11 * k, lineHeight: 17.6 * k }]}
            numberOfLines={i === all.length - 1 ? 4 : 1}
          >
            {e.time} · {e.text}
          </Text>
        ))}
        <Text style={[styles.logLine, { fontSize: 11 * k, lineHeight: 17.6 * k, color: eyeColor }]}>
          {hhmm()} · {mode}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    height: '100%',
    overflow: 'hidden',
  },
  connRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  connLabel: {
    fontFamily: 'JetBrainsMono_500Medium',
    color: '#4e5a54',
  },
  sectionLabel: {
    fontFamily: 'JetBrainsMono_500Medium',
    color: '#3e4744',
  },
  lastSaid: {
    fontFamily: 'SpaceGrotesk_400Regular',
    color: '#d6efe4',
  },
  logLine: {
    fontFamily: 'JetBrainsMono_400Regular',
    color: '#5c6a63',
  },
});
