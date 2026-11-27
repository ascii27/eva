import { describe, expect, it } from '@jest/globals';
import { locationReply, parsePlace, placeAnswer, placeName } from '../place';

describe('placeName', () => {
  it('names the town and region', () => {
    expect(placeName({ city: 'Yokohama', region: 'Kanagawa', country: 'Japan' })).toBe('Yokohama, Kanagawa');
  });

  it('falls back to subregion, then district, when iOS leaves city empty', () => {
    expect(placeName({ city: null, subregion: 'Hayama', region: 'Kanagawa' })).toBe('Hayama, Kanagawa');
    expect(placeName({ city: '', subregion: '', district: 'Shibuya', region: 'Tokyo' })).toBe('Shibuya, Tokyo');
  });

  it('does not repeat a region that is the town', () => {
    expect(placeName({ city: 'Tokyo', region: 'Tokyo', country: 'Japan' })).toBe('Tokyo');
  });

  it('uses the country only when there is no region', () => {
    expect(placeName({ city: 'Singapore', country: 'Singapore' })).toBe('Singapore');
    expect(placeName({ city: 'Monaco', country: 'France' })).toBe('Monaco, France');
  });

  it('is null when nothing names a town', () => {
    expect(placeName({ region: 'Kanagawa', country: 'Japan' })).toBeNull();
    expect(placeName(null)).toBeNull();
  });

  it('never reads street-level fields, even when they are present', () => {
    // The geocoder's `name` and `street` are often a full address; the type
    // doesn't even admit them, and the output can only be built from towns up.
    const area = { city: 'Yokohama', region: 'Kanagawa', street: '1-2-3 Minatomirai', name: '1-2-3', postalCode: '220-0012' };
    expect(placeName(area)).toBe('Yokohama, Kanagawa');
  });
});

describe('parsePlace', () => {
  it('round-trips a stored place', () => {
    expect(parsePlace(JSON.stringify({ name: 'Yokohama, Kanagawa', setAt: 5 }))).toEqual({ name: 'Yokohama, Kanagawa', setAt: 5 });
  });

  it('reads anything malformed as never set', () => {
    expect(parsePlace(null)).toBeNull();
    expect(parsePlace('not json')).toBeNull();
    expect(parsePlace(JSON.stringify({ name: '  ', setAt: 5 }))).toBeNull();
    expect(parsePlace(JSON.stringify({ name: 'X' }))).toBeNull();
  });
});

describe('spoken and posted lines', () => {
  const place = { name: 'Yokohama, Kanagawa', setAt: 0 };

  it('tells the model the town and how to say it', () => {
    expect(placeAnswer(place)).toContain('Yokohama, Kanagawa');
    expect(placeAnswer(place)).toMatch(/never a street/);
  });

  it('answers hermes with the town or the error', () => {
    expect(locationReply({ place })).toBe('The desk is in Yokohama, Kanagawa.');
    expect(locationReply({ error: 'no fix' })).toContain('no fix');
  });

  it('never echoes a request token back to hermes', () => {
    for (const line of [locationReply({ place }), locationReply({ error: 'x' })]) {
      expect(line).not.toMatch(/\[\[/);
    }
  });
});
