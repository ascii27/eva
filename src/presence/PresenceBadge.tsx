// The presence badge (ASC-47): on the face, for exactly as long as the
// presence camera is running. The promise is that anyone looking at Eva can
// tell the lens is live, even though no picture is ever taken.
//
// It matches ASC-43's CAMERA ON badge — same spot, same red dot, same type —
// so the two read as one signal: the camera is on. They never show together,
// because presence steps aside while the photo viewfinder is up. Static on
// purpose; a pulse would be a new animation value the design file doesn't have.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface PresenceBadgeProps {
  eyeColor: string;
  k: number;
  /** Width of the side column, so the badge sits on the face rather than under it. */
  right: number;
}

const REC = '#ff5f56';

export function PresenceBadge({ eyeColor, k, right }: PresenceBadgeProps) {
  return (
    <View
      pointerEvents="none"
      accessibilityLabel="Camera is on, watching for presence"
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
      <Text style={[styles.text, { fontSize: 10 * k, letterSpacing: 1.4 * k }]}>WATCHING</Text>
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
