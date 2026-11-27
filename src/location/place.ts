// Where Eva is, to the nearest town — pure, no React, no I/O.
//
// The phone lives on one desk, so "where am I" is a setting rather than a
// stream: it is read once (the overlay's Set location, or the first time she
// is asked), boiled down to a municipality, and that name is all that is ever
// kept. Coordinates exist only inside `locate.ts`'s read and are dropped there,
// so nothing that writes to disk, to OpenAI, or to Slack can see them — by
// construction rather than by filtering, the same rule photos follow.
//
// The privacy rule from ASC-44 — never speak or store a precise location — is
// enforced in `placeName`, which reads only town-and-above fields of the
// geocode. Street, number, postcode and the geocoder's `name` (often a street
// address) are never looked at. There is deliberately no spoken ask before a
// read (Michael's decision, Nov 27); iOS permission is the only gate.

/** The subset of expo-location's LocationGeocodedAddress this reads. */
export interface GeocodedArea {
  city?: string | null;
  subregion?: string | null;
  district?: string | null;
  region?: string | null;
  country?: string | null;
}

/** What is stored: the name, and when it was read. Never coordinates. */
export interface Place {
  /** e.g. "Yokohama, Kanagawa". */
  name: string;
  /** Epoch ms of the read. */
  setAt: number;
}

const clean = (s: string | null | undefined): string => (typeof s === 'string' ? s.trim() : '');

/**
 * "Town, Region" from a reverse geocode, or null when it names no town at all.
 *
 * The town falls back city → subregion → district: outside a city iOS often
 * leaves `city` empty and puts the municipality in `subregion`. The region is
 * dropped when it repeats the town (Tokyo, Tokyo) and the country only appears
 * when there is no region to stand in for it.
 */
export function placeName(area: GeocodedArea | null | undefined): string | null {
  if (!area) return null;
  const town = clean(area.city) || clean(area.subregion) || clean(area.district);
  if (!town) return null;
  const region = clean(area.region);
  const country = clean(area.country);
  const wider = region && region.toLowerCase() !== town.toLowerCase() ? region : !region ? country : '';
  return wider && wider.toLowerCase() !== town.toLowerCase() ? `${town}, ${wider}` : town;
}

/** A stored place, validated — anything malformed reads as never set. */
export function parsePlace(raw: string | null): Place | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Place>;
    if (typeof v.name !== 'string' || !v.name.trim() || typeof v.setAt !== 'number') return null;
    return { name: v.name.trim(), setAt: v.setAt };
  } catch {
    return null;
  }
}

/** The tool's answer — the name, plus the rule on how to say it. */
export function placeAnswer(place: Place): string {
  return `You are in ${place.name}. Say it as a town and region only, in a few words — never a street, an address or coordinates.`;
}

/**
 * The thread reply hermes reads after a `[[location]]`. Plain sentences, so
 * the same line makes sense to a person scrolling the channel.
 */
export function locationReply(outcome: { place: Place } | { error: string }): string {
  if ('place' in outcome) return `The desk is in ${outcome.place.name}.`;
  return `I couldn't read the location: ${outcome.error}`;
}
