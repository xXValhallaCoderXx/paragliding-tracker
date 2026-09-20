import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { bindPlaybackAppState, ReplayPlayback, type PlaybackSnapshot } from '@/lib/replay/playback';
import { useReducedMotion } from '@/lib/use-reduced-motion';

export type ReplayBookmark = Pick<PlaybackSnapshot, 'elapsedMs' | 'speed'>;

export function useReplayPlayback(durationMs: number, bookmark?: ReplayBookmark | null, onRelease?: (bookmark: ReplayBookmark) => void) {
  const [controller] = useState(() => {
    const playback = new ReplayPlayback(durationMs, () => performance.now());
    if (bookmark) {
      playback.seek(bookmark.elapsedMs);
      playback.setSpeed(bookmark.speed);
    }
    return playback;
  });
  const [state, setState] = useState(() => controller.snapshot());
  const reducedMotion = useReducedMotion();
  const refresh = useCallback(() => setState(controller.snapshot()), [controller]);
  useEffect(() => bindPlaybackAppState(controller, AppState, refresh), [controller, refresh]);
  useEffect(() => () => {
    controller.pause();
    const { elapsedMs, speed } = controller.snapshot();
    onRelease?.({ elapsedMs, speed });
  }, [controller, onRelease]);
  useFocusEffect(useCallback(() => {
    controller.setPresence('screen', true);
    return () => { controller.setPresence('screen', false); refresh(); };
  }, [controller, refresh]));

  useEffect(() => {
    if (!state.playing) return;
    let frame = 0;
    let lastPaint = 0;
    const tick = (now: number) => {
      const next = controller.snapshot();
      // At most 30 Hz; reduced motion steps at 4 Hz without changing recorded timing.
      if (now - lastPaint >= (reducedMotion ? 250 : 1000 / 30) || !next.playing) {
        setState(next);
        lastPaint = now;
      }
      if (next.playing) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [controller, state.playing, reducedMotion]);

  return { controller, state, refresh, reducedMotion };
}
