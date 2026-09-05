import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { paper } from '@/ui/theme';
import { replayTime } from './replay-time';

const THUMB_SIZE = 24;

/** Native responder + adjustable accessibility actions, without another native dependency. */
export function ReplayTimeline({ elapsedMs, durationMs, onSeek, onScrubbing }: {
  elapsedMs: number; durationMs: number; onSeek: (ms: number) => void; onScrubbing: (scrubbing: boolean) => void;
}) {
  const [width, setWidth] = useState(0);
  const trackWidth = Math.max(0, width - THUMB_SIZE);
  const progress = durationMs > 0 ? Math.max(0, Math.min(1, elapsedMs / durationMs)) : 0;
  // Touches, rail and thumb all use the same span between the thumb's centres.
  const seekAt = (x: number) => {
    if (trackWidth > 0) onSeek(Math.max(0, Math.min(1, (x - THUMB_SIZE / 2) / trackWidth)) * durationMs);
  };
  return (
    <View accessible accessibilityRole="adjustable" accessibilityLabel="Replay timeline"
      accessibilityHint="Swipe up or down to seek ten seconds. Touch and drag to scrub. Seeking pauses playback."
      accessibilityValue={{ min: 0, max: Math.round(durationMs / 1000), now: Math.round(elapsedMs / 1000), text: `${replayTime(elapsedMs)} of ${replayTime(durationMs)}` }}
      accessibilityActions={[{ name: 'increment', label: 'Forward ten seconds' }, { name: 'decrement', label: 'Back ten seconds' }]}
      onAccessibilityAction={({ nativeEvent }) => {
        if (nativeEvent.actionName === 'increment') onSeek(elapsedMs + 10_000);
        if (nativeEvent.actionName === 'decrement') onSeek(elapsedMs - 10_000);
      }}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={(event) => { onScrubbing(true); seekAt(event.nativeEvent.locationX); }}
      onResponderMove={(event) => seekAt(event.nativeEvent.locationX)}
      onResponderRelease={(event) => { seekAt(event.nativeEvent.locationX); onScrubbing(false); }}
      onResponderTerminate={() => onScrubbing(false)}
      onResponderTerminationRequest={() => false}
      style={styles.touch}>
      <View pointerEvents="none" style={styles.rail}>
        <View style={[styles.fill, { width: `${progress * 100}%` }]} />
      </View>
      <View pointerEvents="none" style={[styles.thumb, { left: trackWidth * progress }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  touch: { minHeight: 52, justifyContent: 'center', width: '100%' },
  rail: { height: 6, marginHorizontal: THUMB_SIZE / 2, borderRadius: 3, backgroundColor: paper.border, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: paper.thermal },
  thumb: { position: 'absolute', width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: THUMB_SIZE / 2, backgroundColor: paper.thermal, borderWidth: 3, borderColor: paper.card },
});
