// One location read: approximate fix → reverse geocode → municipality name.
//
// Like camera.ts, the native module only exists in a build that carries it, so
// it is required lazily and every entry point degrades to a readable error
// rather than crashing the face. Nothing here throws.
//
// This is the ONLY place coordinates exist. They go from the fix straight into
// the geocoder and out of scope; what leaves the function is a name.

import { placeName, type Place } from './place';

type LocationModule = typeof import('expo-location');

let mod: LocationModule | null | undefined;

function getLocation(): LocationModule | null {
  if (mod === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { requireOptionalNativeModule } = require('expo');
      mod = requireOptionalNativeModule('ExpoLocation')
        ? // eslint-disable-next-line @typescript-eslint/no-require-imports
          (require('expo-location') as LocationModule)
        : null;
    } catch {
      mod = null;
    }
  }
  return mod;
}

/** Whether this build can read location at all — decides if the tool is offered. */
export function isLocationAvailable(): boolean {
  return getLocation() !== null;
}

/**
 * Whether iOS has already granted location, without ever asking. For hermes'
 * `[[location]]`, which may arrive with nobody at the desk to answer a dialog.
 */
export async function hasLocationPermission(): Promise<boolean> {
  const m = getLocation();
  if (!m) return false;
  try {
    return (await m.getForegroundPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/**
 * Ensure iOS has granted when-in-use location — the only gate in front of a
 * read. The dialog appears once, on the first read.
 */
export async function ensureLocationPermission(): Promise<boolean> {
  const m = getLocation();
  if (!m) return false;
  try {
    if ((await m.getForegroundPermissionsAsync()).granted) return true;
    return (await m.requestForegroundPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/**
 * Read where the desk is, to the nearest town. Lowest accuracy is deliberate:
 * a town needs a fix good to a few kilometres, and asking for less is both
 * faster and the honest amount to ask for.
 */
export async function readPlace(now: number): Promise<{ place: Place } | { error: string }> {
  const m = getLocation();
  if (!m) return { error: 'location is not available on this build.' };
  try {
    const fix = await m.getCurrentPositionAsync({ accuracy: m.Accuracy.Lowest });
    const areas = await m.reverseGeocodeAsync({
      latitude: fix.coords.latitude,
      longitude: fix.coords.longitude,
    });
    const name = placeName(areas[0]);
    if (!name) return { error: 'the location did not resolve to a town.' };
    return { place: { name, setAt: now } };
  } catch (e) {
    return { error: `the location could not be read: ${e instanceof Error ? e.message : String(e)}` };
  }
}
