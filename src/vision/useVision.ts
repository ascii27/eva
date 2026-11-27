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
//
// The thumbnail expires on its own (ASC-50, `thumbnail.ts`): shortly after the
// reply is spoken, or at a hard ceiling. Only the display goes — the photo
// stays in the window for follow-ups.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  capture,
  deletePhotoFile,
  getCameraPermission,
  isCameraAvailable,
  requestCameraPermission,
  type CameraHandle,
} from './camera';
import { remember, resolveDataUrl, type Photo } from './photos';
import { thumbnailDeadline } from './thumbnail';

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
  /** Capture time of the photo the thumbnail shows, while it is up. */
  const shownAt = useRef<number | null>(null);
  const expiry = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearExpiry = useCallback(() => {
    if (expiry.current) clearTimeout(expiry.current);
    expiry.current = null;
  }, []);

  /** (Re)arm the thumbnail's take-down for the photo captured at `shownAt`. */
  const scheduleExpiry = useCallback(
    (replyEndedAt: number | null) => {
      const capturedAt = shownAt.current;
      if (capturedAt === null) return;
      clearExpiry();
      const delay = Math.max(0, thumbnailDeadline(capturedAt, replyEndedAt) - Date.now());
      expiry.current = setTimeout(() => {
        expiry.current = null;
        shownAt.current = null;
        setThumbnailUri(null);
      }, delay);
    },
    [clearExpiry],
  );

  useEffect(() => clearExpiry, [clearExpiry]);

  /**
   * The face just stopped speaking. If a thumbnail is up and this was the
   * answer to its look, bring the take-down forward. Harmless otherwise.
   */
  const replyEnded = useCallback(() => scheduleExpiry(Date.now()), [scheduleExpiry]);

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
    shownAt.current = result.photo.takenAt;
    scheduleExpiry(null);
    // Whatever aged out is gone from the conversation, so its bytes should go
    // too — the cache is the only place a photo was ever durable.
    for (const old of next.evicted) deletePhotoFile(old);
    if (__DEV__) {
      console.log(
        `[vision] captured ${result.photo.id} · ${photos.current.length} live · ${next.evicted.length} evicted`,
      );
    }
    return result;
  }, [waitForCamera, scheduleExpiry]);

  /**
   * Photo bytes by id, for `buildRequest`. Returns null once a photo has aged
   * out, which is what makes the turn degrade to its caption.
   */
  const resolvePhoto = useCallback((id: string): string | null => resolveDataUrl(photos.current, id), []);

  /** Drop every photo and its file — wired to the overlay's Forget all. */
  const forgetPhotos = useCallback(() => {
    for (const photo of photos.current) deletePhotoFile(photo);
    photos.current = [];
    clearExpiry();
    shownAt.current = null;
    setThumbnailUri(null);
  }, [clearExpiry]);

  return {
    available: available.current,
    state: { previewing, thumbnailUri } satisfies VisionState,
    onCameraReady,
    showPreview,
    hidePreview,
    replyEnded,
    ensurePermission,
    takePhoto,
    resolvePhoto,
    forgetPhotos,
  };
}
