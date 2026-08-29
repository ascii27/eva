// Eva's eye: the camera ref, the photo window, and the file cleanup.
//
// Owned by FaceScreen, mirroring useAgent and useSlack. All the timing and I/O
// live here; the decisions live in the pure modules next door (`photos.ts` for
// the window, `consent.ts` for the answer).
//
// The interesting invariant is that `photos` is a ref rather than state. The
// agent loop resolves photo bytes synchronously while building a request, so
// it cannot wait for a render — but the *thumbnail* is state, because the side
// column does need to re-render. They are updated together.

import { useCallback, useRef, useState } from 'react';
import {
  capture,
  deletePhotoFile,
  getCameraPermission,
  isCameraAvailable,
  requestCameraPermission,
  type CameraHandle,
} from './camera';
import { remember, resolveDataUrl, type Photo } from './photos';

/** How long the shutter waits for a camera that is still coming up. */
const CAMERA_READY_TIMEOUT_MS = 3_000;

export interface UseVisionOptions {
  /** Transcript breadcrumbs, same channel as every other subsystem. */
  onIssue?: (message: string) => void;
}

export interface VisionState {
  /** The gate is open: the viewfinder is on screen and the lens is live. */
  previewing: boolean;
  /** Most recent captured frame, for the side column. */
  thumbnailUri: string | null;
}

export function useVision({ onIssue }: UseVisionOptions = {}) {
  const [previewing, setPreviewing] = useState(false);
  const [thumbnailUri, setThumbnailUri] = useState<string | null>(null);
  const photos = useRef<Photo[]>([]);
  const camera = useRef<CameraHandle | null>(null);
  const available = useRef(isCameraAvailable());
  const notify = useRef(onIssue);
  notify.current = onIssue;

  /** Wired to CameraPreview; null on unmount. */
  const onCameraReady = useCallback((handle: CameraHandle | null) => {
    camera.current = handle;
  }, []);

  /** Mount the viewfinder. Called as the consent gate opens, so the camera
   *  warms up while Eva is still asking the question. */
  const showPreview = useCallback(() => setPreviewing(true), []);
  const hidePreview = useCallback(() => setPreviewing(false), []);

  /**
   * Ensure iOS has granted camera access. Deliberately called *before* the
   * consent question is spoken: the permission dialog is a modal, and one
   * landing on an open microphone would swallow the answer.
   */
  const ensurePermission = useCallback(async (): Promise<boolean> => {
    if (!available.current) return false;
    if (await getCameraPermission()) return true;
    return requestCameraPermission();
  }, []);

  /**
   * Wait for `onCameraReady`, briefly.
   *
   * Normally the camera is long since warm — it mounts before the consent
   * question is spoken, and that plus an answer is seconds. But a fast "yes"
   * over a slow warm-up would otherwise fail the shutter for no reason, and
   * having just asked permission is the worst moment to come back empty.
   */
  const waitForCamera = useCallback(async (): Promise<CameraHandle | null> => {
    const deadline = Date.now() + CAMERA_READY_TIMEOUT_MS;
    while (!camera.current && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return camera.current;
  }, []);

  /**
   * Take the photo. Returns the new photo, or an error string for the model to
   * say out loud — never throws, because this is reached from inside a tool.
   */
  const takePhoto = useCallback(async (): Promise<{ photo: Photo } | { error: string }> => {
    const handle = await waitForCamera();
    if (!handle) return { error: 'the camera did not come up in time.' };

    const result = await capture(handle, Date.now());
    if ('error' in result) {
      notify.current?.(`vision · ${result.error}`);
      return result;
    }

    const next = remember(photos.current, result.photo);
    photos.current = next.photos;
    setThumbnailUri(result.photo.uri);
    // Whatever aged out is gone from the conversation, so its bytes should go
    // too — the cache is the only place a photo was ever durable.
    for (const old of next.evicted) deletePhotoFile(old);
    if (__DEV__) {
      console.log(
        `[vision] captured ${result.photo.id} · ${photos.current.length} live · ${next.evicted.length} evicted`,
      );
    }
    return result;
  }, [waitForCamera]);

  /**
   * Photo bytes by id, for `buildRequest`. Returns null once a photo has aged
   * out, which is what makes the turn degrade to its caption.
   */
  const resolvePhoto = useCallback((id: string): string | null => resolveDataUrl(photos.current, id), []);

  /** Drop every photo and its file — wired to the overlay's Forget all. */
  const forgetPhotos = useCallback(() => {
    for (const photo of photos.current) deletePhotoFile(photo);
    photos.current = [];
    setThumbnailUri(null);
  }, []);

  return {
    available: available.current,
    state: { previewing, thumbnailUri } satisfies VisionState,
    onCameraReady,
    showPreview,
    hidePreview,
    ensurePermission,
    takePhoto,
    resolvePhoto,
    forgetPhotos,
  };
}
