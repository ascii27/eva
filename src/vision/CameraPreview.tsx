// The viewfinder, mounted only while a consent gate is open.
//
// It is not merely decoration: `takePictureAsync` needs a live `CameraView`, so
// this being on screen is also what makes the shutter possible. Mounting it at
// the start of the gate gives the camera the whole spoken question to warm up,
// which is why the capture that follows is instant.
//
// Lazily required like everything else that touches native code, so Expo Go
// renders the placeholder instead of redboxing.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { CameraHandle } from './camera';

interface CameraPreviewProps {
  /** Receives the live camera, or null on unmount. */
  onReady: (camera: CameraHandle | null) => void;
  eyeColor: string;
  k: number;
  width: number;
  height: number;
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

export function CameraPreview({ onReady, eyeColor, k, width, height }: CameraPreviewProps) {
  const View_ = getCameraView();
  const ref = React.useRef<CameraHandle | null>(null);

  // Hand the camera back on unmount as well, so a gate that ends without a
  // capture cannot leave useVision holding a ref into a dead view.
  React.useEffect(() => {
    return () => onReady(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const frame = {
    width,
    height,
    borderRadius: 6 * k,
    borderWidth: 1,
    borderColor: `${eyeColor}44`,
  } as const;

  if (!View_) {
    return (
      <View style={[styles.placeholder, frame]}>
        <Text style={[styles.placeholderText, { fontSize: 9 * k }]}>NO CAMERA</Text>
      </View>
    );
  }

  return (
    <View style={[styles.frame, frame]}>
      <View_
        ref={(instance: CameraHandle | null) => {
          ref.current = instance;
        }}
        style={StyleSheet.absoluteFill}
        facing="front"
        // Default is 'picture', which takes no microphone permission — that is
        // what keeps the camera out of a fight with the speech recognizer for
        // the iOS audio session.
        mode="picture"
        // Left off deliberately. Mirroring would make the preview feel natural
        // but flips the captured frame too, and anything with text on it would
        // reach the model backwards.
        mirror={false}
        onCameraReady={() => onReady(ref.current)}
      />
      <View style={[styles.recRow, { gap: 5 * k, top: 6 * k, left: 7 * k }]}>
        <View
          style={{
            width: 5 * k,
            height: 5 * k,
            borderRadius: 2.5 * k,
            backgroundColor: '#ff5f56',
            shadowColor: '#ff5f56',
            shadowOpacity: 0.8,
            shadowRadius: 3 * k,
            shadowOffset: { width: 0, height: 0 },
          }}
        />
        <Text style={[styles.recText, { fontSize: 8 * k, letterSpacing: 1.1 * k }]}>LIVE</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    backgroundColor: '#0b0f0d',
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0b0f0d',
  },
  placeholderText: {
    fontFamily: 'JetBrainsMono_500Medium',
    color: '#3e4744',
  },
  recRow: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
  },
  recText: {
    fontFamily: 'JetBrainsMono_500Medium',
    color: '#d6efe4',
  },
});
