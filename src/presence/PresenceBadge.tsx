// The presence indicator (ASC-47): on the face, for exactly as long as the
// presence camera is running. The promise is that anyone looking at Eva can
// tell the lens is live, even though no picture is ever taken.
//
// Just the red dot (ASC-53). It used to be a WATCHING pill matching ASC-43's
// CAMERA ON badge, but presence is on for hours at a time and her open eyes
// already say she's watching; the dot only has to say the lens is live. Same
// red and same spot as CAMERA ON, so the two still read as one signal — and
// they never show together, because presence steps aside while the photo
// viewfinder is up. Static on purpose; a pulse would be a new animation value
// the design file doesn't have.

import React from 'react';
import { View } from 'react-native';

interface PresenceBadgeProps {
  k: number;
  /** Width of the side column, so the dot sits on the face rather than under it. */
  right: number;
}

const REC = '#ff5f56';
const DOT = 5;

export function PresenceBadge({ k, right }: PresenceBadgeProps) {
  return (
    <View
      pointerEvents="none"
      accessible
      accessibilityLabel="Camera is on, watching for presence"
      style={{
        position: 'absolute',
        top: 20 * k,
        right: right + 22 * k,
        width: DOT * k,
        height: DOT * k,
        borderRadius: (DOT / 2) * k,
        backgroundColor: REC,
        opacity: 0.85,
        shadowColor: REC,
        shadowOpacity: 0.6,
        shadowRadius: 3 * k,
        shadowOffset: { width: 0, height: 0 },
      }}
    />
  );
}
