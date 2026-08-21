// Taking one photo: shutter, downscale, and the bytes that go to OpenAI.
//
// The native modules only exist in the EAS dev build, so — like stt.ts — they
// are required lazily and every entry point degrades to a readable error
// rather than crashing the face. `isCameraAvailable()` is what decides whether
// the tool is offered at all (see tools/specs.ts).
//
// Nothing here throws. A tool that throws would take down a round that is
// already speaking aloud, so failures come back as `{ error }` for the model
// to say out loud.

import { File } from 'expo-file-system';
import { photoId, type Photo } from './photos';

/**
 * Longest edge of the image actually sent. Full-resolution iPhone frames are
 * several megabytes of base64 over a phone's uplink for no gain: OpenAI tiles
 * anything larger anyway, and 1024 is enough to read a label held up to the
 * desk.
 */
const MAX_EDGE = 1024;

/** JPEG quality of the downscaled frame. */
const COMPRESS = 0.8;

/** What `takePictureAsync` needs from the mounted CameraView. */
export interface CameraHandle {
  takePictureAsync(options?: {
    quality?: number;
    skipProcessing?: boolean;
    shutterSound?: boolean;
  }): Promise<{ uri: string } | undefined>;
}

export type CaptureResult = { photo: Photo } | { error: string };

type CameraModule = typeof import('expo-camera');
type ManipulatorModule = typeof import('expo-image-manipulator');

let cameraMod: CameraModule | null | undefined;
let manipulatorMod: ManipulatorModule | null | undefined;

function getCamera(): CameraModule | null {
  if (cameraMod === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { requireOptionalNativeModule } = require('expo');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      cameraMod = requireOptionalNativeModule('ExpoCamera') ? (require('expo-camera') as CameraModule) : null;
    } catch {
      cameraMod = null;
    }
  }
  return cameraMod;
}

function getManipulator(): ManipulatorModule | null {
  if (manipulatorMod === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { requireOptionalNativeModule } = require('expo');
      manipulatorMod = requireOptionalNativeModule('ExpoImageManipulator')
        ? // eslint-disable-next-line @typescript-eslint/no-require-imports
          (require('expo-image-manipulator') as ManipulatorModule)
        : null;
    } catch {
      manipulatorMod = null;
    }
  }
  return manipulatorMod;
}

/**
 * Whether this build can see at all. False in Expo Go and anywhere the native
 * modules are missing, which is what keeps `camera_look` out of the spec list
 * rather than present and always failing — the same rule `web_search` follows
 * without a Tavily key.
 */
export function isCameraAvailable(): boolean {
  return getCamera() !== null && getManipulator() !== null;
}

/** The `useCameraPermissions`-equivalent imperative calls, for useVision. */
export async function getCameraPermission(): Promise<boolean> {
  const mod = getCamera();
  if (!mod) return false;
  try {
    return (await mod.Camera.getCameraPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/**
 * Ask iOS for camera access. Called on the first `camera_look` and never with
 * the microphone already open — an OS modal landing on a live consent listen
 * would eat the answer.
 */
export async function requestCameraPermission(): Promise<boolean> {
  const mod = getCamera();
  if (!mod) return false;
  try {
    return (await mod.Camera.requestCameraPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

function unlink(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // A leftover cache file is the OS's problem, not a reason to fail a round.
  }
}

/** Delete a photo's file — called when the window evicts it. */
export function deletePhotoFile(photo: Photo): void {
  unlink(photo.uri);
}

/**
 * Shutter, downscale, and read back. `saveAsync` writes into the cache
 * directory itself, so the returned uri is already where we want it and the
 * only cleanup is the full-resolution original.
 */
export async function capture(camera: CameraHandle, takenAt: number): Promise<CaptureResult> {
  const manipulator = getManipulator();
  if (!manipulator) return { error: 'the camera is not available on this build.' };

  let originalUri: string | null = null;
  try {
    // shutterSound stays at its default: on an appliance with no viewfinder
    // it is the only feedback that the photo actually happened, and the mic is
    // already closed by this point so it cannot be heard as speech.
    const shot = await camera.takePictureAsync({ quality: 0.9, skipProcessing: false });
    if (!shot?.uri) return { error: 'the camera did not return a photo.' };
    originalUri = shot.uri;

    const context = manipulator.ImageManipulator.manipulate(shot.uri);
    // One dimension only — the other is derived, preserving the aspect ratio.
    const rendered = await context.resize({ width: MAX_EDGE }).renderAsync();
    const out = await rendered.saveAsync({
      format: manipulator.SaveFormat.JPEG,
      compress: COMPRESS,
      base64: true,
    });
    if (!out.base64) return { error: 'the photo could not be read back.' };

    return {
      photo: {
        id: photoId(takenAt),
        uri: out.uri,
        dataUrl: `data:image/jpeg;base64,${out.base64}`,
        takenAt,
      },
    };
  } catch (e) {
    return { error: `the camera failed: ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    // The full-resolution frame is several megabytes and is never used again.
    if (originalUri) unlink(originalUri);
  }
}
