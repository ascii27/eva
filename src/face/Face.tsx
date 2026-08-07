import { BlurMask, Canvas, Group, Oval, Path, Rect, RoundedRect, Skia } from '@shopify/react-native-skia';
import type { SkPath } from '@shopify/react-native-skia';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Easing,
  useDerivedValue,
  useFrameCallback,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  BLINK_MIN_GAP,
  BLINK_RAND_GAP,
  CONFUSED_TILT_DEG,
  EYE_GAP,
  EYE_H,
  EYE_W,
  FIRST_BLINK_MIN,
  FIRST_BLINK_RAND,
  FIRST_YAWN_MIN,
  FIRST_YAWN_RAND,
  GLOW_INNER,
  GLOW_OUTER,
  MOUTH_BOTTOM,
  MOUTH_ROW_H,
  VISEME_FRAME_MS,
  WAVE_AMP_H,
  WAVE_BAR_GAP,
  WAVE_BAR_W,
  WAVE_BARS,
  WAVE_BASE_H,
  WAVE_BOTTOM,
  WAVE_ROW_H,
  YAWN_MIN_GAP,
  YAWN_RAND_GAP,
} from './constants';
import { eyeGeo, hexToRgba, isSleepyHour } from './geometry';
import type { CornerRadii, FaceMode, MouthOutput } from './types';
import { amp, isSmiling, pickViseme, SMILE, teethHeight, TONGUE, VIS, VisemeKey } from './visemes';

const NEVER = -9e9;

interface FaceProps {
  mode: FaceMode;
  eyeColor: string;
  output: MouthOutput;
  frozen: VisemeKey | null;
  width: number;
  height: number;
  /** uniform design-px → screen-px scale */
  k: number;
  /** bump to trigger a manual blink / yawn (dev controls) */
  blinkNonce?: number;
  yawnNonce?: number;
}

function makeCenteredRRect(w: number, h: number, c: CornerRadii, k: number): SkPath {
  return Skia.Path.RRect({
    rect: { x: (-w / 2) * k, y: (-h / 2) * k, width: w * k, height: h * k },
    topLeft: { x: c.tl.x * k, y: c.tl.y * k },
    topRight: { x: c.tr.x * k, y: c.tr.y * k },
    bottomRight: { x: c.br.x * k, y: c.br.y * k },
    bottomLeft: { x: c.bl.x * k, y: c.bl.y * k },
  });
}

export function Face({
  mode,
  eyeColor,
  output,
  frozen,
  width,
  height,
  k,
  blinkNonce = 0,
  yawnNonce = 0,
}: FaceProps) {
  const clock = useSharedValue(0);
  const modeSV = useSharedValue<FaceMode>(mode);
  const blinkT = useSharedValue(NEVER);
  const yawnT = useSharedValue(NEVER);
  const nextBlink = useSharedValue(FIRST_BLINK_MIN + Math.random() * FIRST_BLINK_RAND);
  const nextYawn = useSharedValue(
    isSleepyHour(new Date().getHours()) ? FIRST_YAWN_MIN + Math.random() * FIRST_YAWN_RAND : Infinity,
  );

  // The clock plus the idle blink/yawn scheduler, all on the UI thread.
  useFrameCallback((frame) => {
    const t = frame.timeSinceFirstFrame;
    clock.value = t;
    if (modeSV.value === 'idle') {
      if (t > nextBlink.value) {
        blinkT.value = t;
        nextBlink.value = t + BLINK_MIN_GAP + Math.random() * BLINK_RAND_GAP;
      }
      if (t > nextYawn.value) {
        yawnT.value = t;
        nextYawn.value = t + YAWN_MIN_GAP + Math.random() * YAWN_RAND_GAP;
      }
    }
  });

  // Mode changes clear any in-flight blink/yawn and reschedule, as the design does.
  useEffect(() => {
    modeSV.value = mode;
    blinkT.value = NEVER;
    yawnT.value = NEVER;
    nextBlink.value = clock.value + FIRST_BLINK_MIN + Math.random() * FIRST_BLINK_RAND;
    nextYawn.value = isSleepyHour(new Date().getHours())
      ? clock.value + FIRST_YAWN_MIN + Math.random() * FIRST_YAWN_RAND
      : Infinity;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Manual triggers from dev controls.
  useEffect(() => {
    if (blinkNonce > 0) blinkT.value = clock.value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blinkNonce]);
  useEffect(() => {
    if (yawnNonce > 0) yawnT.value = clock.value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yawnNonce]);

  // Confused tilts the whole face 5°, eased over 0.5s.
  const tilt = useSharedValue(0);
  useEffect(() => {
    tilt.value = withTiming(mode === 'confused' ? CONFUSED_TILT_DEG : 0, {
      duration: 500,
      easing: Easing.inOut(Easing.ease),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  const cx = width / 2;
  const cy = height / 2;
  const tiltTransform = useDerivedValue(() => [{ rotate: (tilt.value * Math.PI) / 180 }]);

  return (
    <Canvas style={{ width, height }}>
      <Group origin={{ x: cx, y: cy }} transform={tiltTransform}>
        <Eye side={-1} mode={mode} eyeColor={eyeColor} k={k} cx={cx} cy={cy} clock={clock} blinkT={blinkT} yawnT={yawnT} />
        <Eye side={1} mode={mode} eyeColor={eyeColor} k={k} cx={cx} cy={cy} clock={clock} blinkT={blinkT} yawnT={yawnT} />
        {output === 'mouth' && (
          <Mouth mode={mode} eyeColor={eyeColor} frozen={frozen} k={k} cx={cx} height={height} />
        )}
        {output === 'wave' && (
          <Waveform mode={mode} eyeColor={eyeColor} k={k} cx={cx} height={height} clock={clock} />
        )}
      </Group>
    </Canvas>
  );
}

type SV<T> = { value: T };

interface EyeProps {
  side: -1 | 1;
  mode: FaceMode;
  eyeColor: string;
  k: number;
  cx: number;
  cy: number;
  clock: SV<number>;
  blinkT: SV<number>;
  yawnT: SV<number>;
}

function Eye({ side, mode, eyeColor, k, cx, cy, clock, blinkT, yawnT }: EyeProps) {
  const path = useMemo(() => {
    const corners = eyeGeo(side, 0, mode, NEVER, NEVER).corners;
    return makeCenteredRRect(EYE_W, EYE_H, corners, k);
  }, [side, mode, k]);

  const transform = useDerivedValue(() => {
    const p = eyeGeo(side, clock.value, mode, blinkT.value, yawnT.value);
    return [
      { translateX: cx + ((side * EYE_GAP) / 2 + p.x) * k },
      { translateY: cy + p.y * k },
      { scaleX: p.sw },
      { scaleY: p.sh },
    ];
  }, [side, mode, k, cx, cy]);

  const innerBlur = useDerivedValue(() => {
    const p = eyeGeo(side, clock.value, mode, blinkT.value, yawnT.value);
    return Math.max(0.1, (GLOW_INNER.blur * p.g * k) / 2);
  }, [side, mode, k]);
  const outerBlur = useDerivedValue(() => {
    const p = eyeGeo(side, clock.value, mode, blinkT.value, yawnT.value);
    return Math.max(0.1, (GLOW_OUTER.blur * p.g * k) / 2);
  }, [side, mode, k]);

  return (
    <Group transform={transform}>
      <Path path={path} color={hexToRgba(eyeColor, GLOW_OUTER.alpha)}>
        <BlurMask blur={outerBlur} style="normal" />
      </Path>
      <Path path={path} color={hexToRgba(eyeColor, GLOW_INNER.alpha)}>
        <BlurMask blur={innerBlur} style="normal" />
      </Path>
      <Path path={path} color={eyeColor} />
    </Group>
  );
}

interface MouthProps {
  mode: FaceMode;
  eyeColor: string;
  frozen: VisemeKey | null;
  k: number;
  cx: number;
  height: number;
}

function Mouth({ mode, eyeColor, frozen, k, cx, height }: MouthProps) {
  // Visemes hard-swap on a 112ms clock while speaking; everything else is static.
  const [tick, setTick] = useState(0);
  const speaking = mode === 'speaking' && !frozen;
  useEffect(() => {
    if (!speaking) return;
    setTick(0);
    const id = setInterval(() => setTick((n) => n + 1), VISEME_FRAME_MS);
    return () => clearInterval(id);
  }, [speaking]);

  const smiling = isSmiling(mode, frozen);
  const key = pickViseme(mode, tick * VISEME_FRAME_MS, frozen);
  const shape = smiling ? SMILE : VIS[key];

  const path = useMemo(
    () => makeCenteredRRect(shape.w, shape.h, shape.corners, k),
    [shape, k],
  );

  const my = height - (MOUTH_BOTTOM + MOUTH_ROW_H / 2) * k;
  const showTeeth = !smiling && !!shape.teeth;
  const showTongue = !smiling && !!shape.tongue;
  const teethH = showTeeth ? teethHeight(shape) * k : 0;

  return (
    <Group transform={[{ translateX: cx }, { translateY: my }]}>
      <Path path={path} color={hexToRgba(eyeColor, 0.25)}>
        <BlurMask blur={Math.max(0.1, (40 * k) / 2)} style="normal" />
      </Path>
      <Path path={path} color={hexToRgba(eyeColor, 0.5)}>
        <BlurMask blur={Math.max(0.1, (16 * k) / 2)} style="normal" />
      </Path>
      <Path path={path} color={eyeColor} />
      <Group clip={path}>
        {showTeeth && (
          <Rect
            x={(-shape.w / 2) * k}
            y={(-shape.h / 2) * k}
            width={shape.w * k}
            height={teethH}
            color="black"
            opacity={0.85}
          />
        )}
        {showTongue && (
          <Oval
            x={(-TONGUE.w / 2) * k}
            y={(shape.h / 2 - TONGUE.h + TONGUE.overhang) * k}
            width={TONGUE.w * k}
            height={TONGUE.h * k}
            color="black"
            opacity={0.7}
          />
        )}
      </Group>
    </Group>
  );
}

interface WaveformProps {
  mode: FaceMode;
  eyeColor: string;
  k: number;
  cx: number;
  height: number;
  clock: SV<number>;
}

function Waveform({ mode, eyeColor, k, cx, height, clock }: WaveformProps) {
  const rowW = (WAVE_BARS * WAVE_BAR_W + (WAVE_BARS - 1) * WAVE_BAR_GAP) * k;
  const cyRow = height - (WAVE_BOTTOM + WAVE_ROW_H / 2) * k;
  const x0 = cx - rowW / 2;
  const opacity = mode === 'idle' ? 0.35 : 0.85;
  const bars = Array.from({ length: WAVE_BARS }, (_, i) => (
    <WaveBar
      key={i}
      i={i}
      x={x0 + i * (WAVE_BAR_W + WAVE_BAR_GAP) * k}
      cy={cyRow}
      mode={mode}
      eyeColor={eyeColor}
      k={k}
      clock={clock}
    />
  ));
  return <Group opacity={opacity}>{bars}</Group>;
}

interface WaveBarProps {
  i: number;
  x: number;
  cy: number;
  mode: FaceMode;
  eyeColor: string;
  k: number;
  clock: SV<number>;
}

function WaveBar({ i, x, cy, mode, eyeColor, k, clock }: WaveBarProps) {
  const h = useDerivedValue(
    () => (WAVE_BASE_H + amp(i, WAVE_BARS, clock.value, mode) * WAVE_AMP_H) * k,
    [i, mode, k],
  );
  const y = useDerivedValue(() => cy - h.value / 2, [cy]);

  return (
    <>
      <RoundedRect x={x} y={y} width={WAVE_BAR_W * k} height={h} r={2 * k} color={hexToRgba(eyeColor, 0.45)}>
        <BlurMask blur={Math.max(0.1, 5 * k)} style="normal" />
      </RoundedRect>
      <RoundedRect x={x} y={y} width={WAVE_BAR_W * k} height={h} r={2 * k} color={eyeColor} />
    </>
  );
}
