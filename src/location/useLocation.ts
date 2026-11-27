// Eva's sense of place: the stored municipality, and the one way to refresh it.
//
// Owned by FaceScreen, like useVision. The stored place lives in a ref as well
// as state: the tool kit is built once at bring-up and reads it synchronously,
// while the overlay needs a re-render to show it.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ensureLocationPermission, hasLocationPermission, isLocationAvailable, readPlace } from './locate';
import { parsePlace, type Place } from './place';

const PLACE_KEY = 'eva.place.v1';

export interface UseLocationOptions {
  onIssue?: (message: string) => void;
}

export function useLocation({ onIssue }: UseLocationOptions = {}) {
  const [place, setPlace] = useState<Place | null>(null);
  const current = useRef<Place | null>(null);
  const available = useRef(isLocationAvailable());
  const notify = useRef(onIssue);
  notify.current = onIssue;

  useEffect(() => {
    void AsyncStorage.getItem(PLACE_KEY).then((raw) => {
      const p = parsePlace(raw);
      // A read that finished before storage came back is newer — keep it.
      if (p && !current.current) {
        current.current = p;
        setPlace(p);
      }
    });
  }, []);

  /** The stored place, synchronously — null when never set. */
  const stored = useCallback((): Place | null => current.current, []);

  /**
   * Read the sensor and store the town. Never throws.
   */
  const refresh = useCallback(async (): Promise<{ place: Place } | { error: string }> => {
    const result = await readPlace(Date.now());
    if ('error' in result) {
      notify.current?.(`location · ${result.error}`);
      return result;
    }
    current.current = result.place;
    setPlace(result.place);
    void AsyncStorage.setItem(PLACE_KEY, JSON.stringify(result.place));
    notify.current?.(`location · ${result.place.name}`);
    return result;
  }, []);

  return {
    available: available.current,
    place,
    stored,
    ensurePermission: ensureLocationPermission,
    hasPermission: hasLocationPermission,
    refresh,
  };
}
