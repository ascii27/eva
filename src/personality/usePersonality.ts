// The current personality, persisted (ASC-59). All policy is in traits.ts;
// this only loads, holds and saves it.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_PERSONALITY, normalizePersonality, type Personality } from './traits';

const PERSONALITY_KEY = 'eva.personality.v1';

export function usePersonality() {
  const [personality, setState] = useState<Personality>(DEFAULT_PERSONALITY);
  // Read synchronously by the brains when they build a request, which must not
  // wait for a render.
  const ref = useRef<Personality>(DEFAULT_PERSONALITY);

  useEffect(() => {
    AsyncStorage.getItem(PERSONALITY_KEY)
      .then((v) => {
        if (!v) return;
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(v);
        } catch {
          // A corrupt file reads as the default rather than as no personality.
        }
        const p = normalizePersonality(parsed);
        ref.current = p;
        setState(p);
      })
      .catch(() => {});
  }, []);

  const set = useCallback((p: Personality) => {
    ref.current = p;
    setState(p);
    AsyncStorage.setItem(PERSONALITY_KEY, JSON.stringify({ traits: p.traits })).catch(() => {});
  }, []);

  return { personality, ref, set };
}
