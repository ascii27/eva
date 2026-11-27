// A key that changes whenever the app comes back to the foreground, so the
// face's Skia canvas is rebuilt rather than trusted to resume.
//
// Found on the device (ASC-43): the first camera round on a fresh install puts
// up iOS's camera-permission alert, which takes the app out of `active` for a
// moment, and when it came back the canvas never drew again. Both the
// UI-thread animation and plain prop changes (the overlay's mouth/wave switch)
// were dead, and only a relaunch recovered it. That matches the
// react-native-skia report of a Canvas that stops presenting after the app is
// suspended and resumed (Shopify/react-native-skia#2135).
//
// The same exit happens for Siri, an incoming call or Control Center — and an
// appliance on a desk has no one to relaunch it. A remount costs one frame and
// resets nothing that matters: the blink/yawn scheduler re-seeds itself, and the
// sleep blend initialises from the `asleep` prop.

import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

export function useResumeKey(): number {
  const [key, setKey] = useState(0);
  useEffect(() => {
    let last: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && last !== 'active') setKey((n) => n + 1);
      last = next;
    });
    return () => sub.remove();
  }, []);
  return key;
}
