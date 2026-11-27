// The front camera as a light meter (ASC-46): a CameraView that exists only
// while a reading is being taken, invisible, with no viewfinder and no shutter
// animation. `takePictureAsync` needs a live view, which is the only reason
// this is a component at all.
//
// Lazily required like CameraPreview, so a build without expo-camera renders
// nothing and useLightMeter reports that it can't measure.

import React from 'react';
import { StyleSheet, View } from 'react-native';

/** What useLightMeter needs from the mounted CameraView. */
export interface MeterHandle {
  takePictureAsync(options?: {
    quality?: number;
    exif?: boolean;
    skipProcessing?: boolean;
    shutterSound?: boolean;
  }): Promise<{ uri: string; exif?: Record<string, unknown> } | undefined>;
}

let CameraView: React.ComponentType<Record<string, unknown>> | null | undefined;

function getCameraView(): React.ComponentType<Record<string, unknown>> | null {
  if (CameraView === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { requireOptionalNativeModule } = require('expo');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      CameraView = requireOptionalNativeModule('ExpoCamera') ? require('expo-camera').CameraView : null;
    } catch {
      CameraView = null;
    }
  }
  return CameraView ?? null;
}

export function LightMeter({ onReady }: { onReady: (camera: MeterHandle | null) => void }) {
  const View_ = getCameraView();
  const ref = React.useRef<MeterHandle | null>(null);

  React.useEffect(() => {
    return () => onReady(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!View_) return null;
  return (
    // A few points square and nearly transparent: AVFoundation will not run a
    // session for a zero-size layer, and nobody needs to see a light meter.
    <View style={styles.hidden} pointerEvents="none">
      <View_
        ref={(instance: MeterHandle | null) => {
          ref.current = instance;
        }}
        style={StyleSheet.absoluteFill}
        facing="front"
        mode="picture"
        animateShutter={false}
        onCameraReady={() => onReady(ref.current)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 4,
    height: 4,
    opacity: 0.01,
    overflow: 'hidden',
  },
});
