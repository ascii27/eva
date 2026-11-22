// Values ported from the Eva Face design (Eva Face.dc.html). All in design
// pixels on the 876x408 inner canvas; Face.tsx scales uniformly to the screen.

export const DESIGN_W = 876;
export const DESIGN_H = 408;

export const EYE_W = 104;
export const EYE_H = 132;
export const EYE_GAP = 300; // separation is fixed wide ("device")
export const EYE_RADIUS = 9;

export const EYE_COLORS = ['#7cf2c4', '#5ec8f2', '#ffffff', '#ffb347'] as const;
export const DEFAULT_EYE_COLOR = EYE_COLORS[0];

// box-shadow blur radii, scaled by the per-state glow multiplier g
export const GLOW_INNER = { blur: 22, alpha: 0.55 };
export const GLOW_OUTER = { blur: 62, alpha: 0.3 };

export const BLINK_MS = 170;
export const BLINK_MIN_GAP = 2600;
export const BLINK_RAND_GAP = 5200;
export const FIRST_BLINK_MIN = 1800;
export const FIRST_BLINK_RAND = 2500;

export const YAWN_MS = 2400;
export const SLEEPY_START_HOUR = 22;
export const SLEEPY_END_HOUR = 6; // ASC-33: also the night window she dims and sleeps in
export const FIRST_YAWN_MIN = 6000;
export const FIRST_YAWN_RAND = 6000;
export const YAWN_MIN_GAP = 40000;
export const YAWN_RAND_GAP = 30000;

export const WAVE_BARS = 34;
export const WAVE_BAR_W = 4;
export const WAVE_BAR_GAP = 5;
export const WAVE_BASE_H = 3;
export const WAVE_AMP_H = 52;
export const WAVE_BOTTOM = 52; // band center sits in a 60px row above this
export const WAVE_ROW_H = 60;

export const MOUTH_BOTTOM = 40;
export const MOUTH_ROW_H = 96;

export const VISEME_FRAME_MS = 112;

export const CONFUSED_TILT_DEG = 5;
export const SIDE_COLUMN_W = 250;

// Asleep (ASC-33). Not in the design file yet: built only from the yawn above,
// so it can be folded into Eva Face.dc.html as-is. Asleep is the yawn's
// nearly-shut hold (k = 0.15) held indefinitely: scaleY k, scaleX 0.94 + 0.1k,
// glow 0.8 + 0.4k, breathing with idle's glow pulse. She drifts off over the
// yawn's droop + hold (600 + 900 ms) and wakes over its 400 ms reopen.
export const ASLEEP_K = 0.15;
export const ASLEEP_SH = ASLEEP_K;
export const ASLEEP_SW = 0.94 + 0.1 * ASLEEP_K;
export const ASLEEP_G = 0.8 + 0.4 * ASLEEP_K;
export const FALL_ASLEEP_MS = 600 + 900;
export const WAKE_UP_MS = 400;
