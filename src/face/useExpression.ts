// What the face is wearing (ASC-59). Policy is in expression.ts; this owns the
// one piece of timing — how long a picked expression outlives the reply.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Traits } from '../personality/traits';
import { EXPRESSION_HOLD_MS, restingExpression, wear, type ExpressionState, type FaceToken } from './expression';
import type { FaceMode } from './types';

/** `onPick` hears every expression Eva picks, for the transcript. */
export function useExpression(mode: FaceMode, traits: Traits, onPick?: (e: ExpressionState) => void) {
  const [expression, setExpression] = useState<ExpressionState>(() => restingExpression(traits));
  // Whether the current expression was picked by Eva, rather than being the
  // personality's resting face. Only a picked one expires.
  const [picked, setPicked] = useState(false);
  const traitsRef = useRef(traits);
  traitsRef.current = traits;
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  const rest = useCallback(() => {
    setPicked(false);
    setExpression(restingExpression(traitsRef.current));
  }, []);

  /** Eva asked for a face, in a reply or a message. */
  const express = useCallback((token: FaceToken) => {
    const worn = wear(token, traitsRef.current);
    setPicked(true);
    setExpression(worn);
    onPickRef.current?.(worn);
  }, []);

  // A new personality changes the resting face straight away — unless she is
  // mid-reaction, in which case it is picked up when that expires.
  const restKey = JSON.stringify(restingExpression(traits));
  useEffect(() => {
    if (!picked) setExpression(restingExpression(traitsRef.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restKey]);

  // Held while she is quiet, then back to resting. Counted from the face
  // reaching idle, so a long follow-up exchange doesn't run the clock down.
  useEffect(() => {
    if (!picked || mode !== 'idle') return;
    const id = setTimeout(rest, EXPRESSION_HOLD_MS);
    return () => clearTimeout(id);
  }, [mode, picked, rest]);

  return { expression, express, rest };
}
