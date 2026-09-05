import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReducedMotion() {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let live = true;
    let receivedChange = false;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
      receivedChange = true;
      if (live) setReduced(value);
    });
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        // The native read can resolve after a newer accessibility event.
        if (live && !receivedChange) setReduced(value);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}
