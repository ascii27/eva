// The camera-on badge, drawn on the face itself (ASC-43).
//
// The side column already shows the viewfinder, but the column can be switched
// off and sits at the edge of the room's view. The promise is that anyone
// looking at Eva can tell when the lens is live, so the badge goes on the face,
// for exactly as long as the viewfinder is mounted: from the moment the consent
// question starts until the shutter, or the refusal.
//
// Same red dot and type as CameraPreview's LIVE marker, so the two read as one
// signal. Static on purpose: the face's animation values come from the design
// file, and a pulsing indicator would be a new one.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface CameraBadgeProps {
  eyeColor: string;
  k: number;
  /** Width of the side column, so the badge sits on the face rather than under it. */
  right: number;
}

const REC = '#ff5f56';

export function CameraBadge({ eyeColor, k, right }: CameraBadgeProps) {
  return (
    <View
      pointerEvents="none"
      accessibilityLabel="Camera is on"
      style={[
        styles.badge,
        {
          top: 16 * k,
          right: right + 18 * k,
          gap: 6 * k,
          paddingHorizontal: 9 * k,
          paddingVertical: 5 * k,
          borderRadius: 4 * k,
          borderColor: `${eyeColor}44`,
        },
      ]}
    >
      <View
        style={{
          width: 7 * k,
          height: 7 * k,
          borderRadius: 3.5 * k,
          backgroundColor: REC,
          shadowColor: REC,
          shadowOpacity: 0.8,
          shadowRadius: 4 * k,
          shadowOffset: { width: 0, height: 0 },
        }}
      />
      <Text style={[styles.text, { fontSize: 10 * k, letterSpacing: 1.4 * k }]}>CAMERA ON</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    backgroundColor: '#0b0f0dcc',
  },
  text: {
    fontFamily: 'JetBrainsMono_500Medium',
    color: '#d6efe4',
  },
});
