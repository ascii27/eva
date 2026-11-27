// Owns the light meter (ASC-46): mounts the hidden camera, waits for
// auto-exposure to settle, takes one frame for its EXIF, deletes it, and
// unmounts. What the exposure means is light.ts's.
//
// Only ever on demand — a tool call or a hermes request — never on a timer.
// Each reading lights the iOS camera indicator for a second, and a phone in a
// region with a mandatory shutter sound may click even with it disabled; a
// meter polling every few minutes would be a desk that clicks at night.

import { useCallback, useRef, useState } from 'react';
import { File } from 'expo-file-system';
import { getCameraPermission, isCameraAvailable, requestCameraPermission } from '../vision/camera';
import { readingFromExif, type LightReading } from './light';
import type { MeterHandle } from './LightMeter';

/** How long the camera may take to come up before the reading is abandoned. */
const READY_TIMEOUT_MS = 3_000;
/** Auto-exposure needs a moment on a cold session; the first frame is too dark. */
const SETTLE_MS = 700;

export type MeterResult = { reading: LightReading } | { error: string };

export interface UseLightMeterOptions {
  /** True while something else holds the camera (camera_look's viewfinder). */
  cameraBusy: () => boolean;
  onIssue?: (message: string) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function unlink(uri: string): void {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // A stray cache file is the OS's problem.
  }
}

export function useLightMeter({ cameraBusy, onIssue }: UseLightMeterOptions) {
  const [metering, setMetering] = useState(false);
  const camera = useRef<MeterHandle | null>(null);
  const last = useRef<LightReading | null>(null);
  const inFlight = useRef<Promise<MeterResult> | null>(null);
  const opts = useRef({ cameraBusy, onIssue });
  opts.current = { cameraBusy, onIssue };
  const available = useRef(isCameraAvailable());

  const onReady = useCallback((handle: MeterHandle | null) => {
    camera.current = handle;
  }, []);

  const run = useCallback(async (mayAsk: boolean): Promise<MeterResult> => {
    if (!available.current) return { error: 'this build has no camera to measure light with.' };
    if (opts.current.cameraBusy()) return { error: 'the camera is in use right now.' };
    // The permission dialog is a modal: only ever raised from a spoken turn,
    // never for a hermes request in an empty room at 3am.
    const granted = (await getCameraPermission()) || (mayAsk && (await requestCameraPermission()));
    if (!granted) return { error: 'camera access has not been allowed on this phone, so the light cannot be measured.' };

    setMetering(true);
    let uri: string | null = null;
    try {
      const deadline = Date.now() + READY_TIMEOUT_MS;
      while (!camera.current && Date.now() < deadline) await sleep(50);
      const handle = camera.current;
      if (!handle) return { error: 'the camera did not come up in time.' };
      await sleep(SETTLE_MS);
      const shot = await handle.takePictureAsync({ quality: 0, exif: true, skipProcessing: true, shutterSound: false });
      uri = shot?.uri ?? null;
      const reading = readingFromExif(shot?.exif, Date.now());
      if (!reading) return { error: 'the camera did not report its exposure.' };
      last.current = reading;
      return { reading };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      opts.current.onIssue?.(`light · ${message}`);
      return { error: `the light meter failed: ${message}` };
    } finally {
      if (uri) unlink(uri);
      setMetering(false);
    }
  }, []);

  /**
   * Take a reading. Never throws. Concurrent callers share one reading rather
   * than mounting two cameras. `mayAsk` lets it raise the iOS permission
   * dialog when access has never been decided.
   */
  const measure = useCallback(
    (mayAsk = false): Promise<MeterResult> => {
      if (!inFlight.current) {
        inFlight.current = run(mayAsk).finally(() => {
          inFlight.current = null;
        });
      }
      return inFlight.current;
    },
    [run],
  );

  /** The most recent reading without measuring, for hermes' status line. */
  const lastReading = useCallback((): LightReading | null => last.current, []);

  return { available: available.current, metering, onReady, measure, lastReading };
}
