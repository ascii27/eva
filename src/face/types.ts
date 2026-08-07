export type FaceMode =
  | 'idle'
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
  corners: CornerRadii;
}
