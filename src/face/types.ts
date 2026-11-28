export type FaceMode =
  | 'idle'
  // The beat after a reply (ASC-59): what used to be a fixed 'pleased' smile.
  // Drawn as idle wearing whatever expression the reply ended on; it is a
  // separate mode only because it must not count as idle — the wake watcher
  // and the realtime release both key off idle exactly.
  | 'resting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'alert'
  | 'confused'
  | 'pleased';

export type MouthOutput = 'mouth' | 'wave' | 'off';

export interface CornerPoint {
  x: number;
  y: number;
}

/** Per-corner radii in design pixels, CSS border-radius order. */
export interface CornerRadii {
  tl: CornerPoint;
  tr: CornerPoint;
  br: CornerPoint;
  bl: CornerPoint;
}

/** One eye's frame-level deformation, in design units. */
export interface EyeGeo {
  sw: number;
  sh: number;
  x: number;
  y: number;
  g: number;
  /** Rotation in degrees, clockwise (ASC-59 expressions; 0 for every design mode). */
  r: number;
  corners: CornerRadii;
}
