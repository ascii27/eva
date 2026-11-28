// A "?" that floats up beside the right eye when Eva has asked something
// (ASC-59 follow-up; see question.ts). Keyed by `nonce`: each bump plays it
// once. Drawn in the eye colour with the eyes' glow, so it reads as part of her.

import React, { useEffect } from 'react';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { EYE_GAP, EYE_H, EYE_W } from './constants';
import { QUESTION_MS, QUESTION_RISE, QUESTION_SIZE } from './question';

interface QuestionMarkProps {
  nonce: number;
  eyeColor: string;
  /** design → screen scale, and the face area's size (the side column excluded) */
  k: number;
  width: number;
  height: number;
}

export function QuestionMark({ nonce, eyeColor, k, width, height }: QuestionMarkProps) {
  const p = useSharedValue(1);
  useEffect(() => {
    if (nonce === 0) return;
    p.value = 0;
    p.value = withTiming(1, { duration: QUESTION_MS, easing: Easing.out(Easing.quad) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  const style = useAnimatedStyle(() => {
    const t = p.value;
    // In fast, hold, then fade over the last 40%.
    const opacity = t < 0.12 ? t / 0.12 : t > 0.6 ? Math.max(0, 1 - (t - 0.6) / 0.4) : 1;
    return {
      opacity,
      transform: [
        { translateY: -QUESTION_RISE * k * t },
        { rotate: `${Math.sin(t * Math.PI * 2) * 8}deg` },
        { scale: 0.85 + 0.15 * Math.min(1, t / 0.12) },
      ],
    };
  });

  // Up and to the right of the right eye.
  const left = width / 2 + (EYE_GAP / 2 + EYE_W / 2 + 14) * k;
  const top = height / 2 - (EYE_H / 2 + QUESTION_SIZE * 0.55) * k;
  return (
    <Animated.Text
      pointerEvents="none"
      accessible={false}
      style={[
        {
          position: 'absolute',
          left,
          top,
          fontSize: QUESTION_SIZE * k,
          fontWeight: '800',
          color: eyeColor,
          textShadowColor: eyeColor,
          textShadowRadius: 14 * k,
          textShadowOffset: { width: 0, height: 0 },
        },
        style,
      ]}
    >
      ?
    </Animated.Text>
  );
}
