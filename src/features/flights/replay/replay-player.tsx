import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Chip, Notice, SectionLabel } from '@/components/ui';
import { formatGroundSpeed, formatMetres } from '@/lib/format/flight-format';
import { buildReplayGeometry } from '@/lib/replay/geometry';
import { telemetryAt, type FlightReplay } from '@/lib/replay/model';
import { REPLAY_SPEEDS } from '@/lib/replay/playback';
import { fonts, paper } from '@/ui/theme';
import { ReplayAltitude } from './replay-plots';
import { ReplayMap } from './replay-map';
import { replayTime } from './replay-time';
import { ReplayTimeline } from './replay-timeline';
import { useReplayPlayback } from './use-replay-playback';

export function ReplayPlayer({ replay }: { replay: Extract<FlightReplay, { kind: 'available' }> }) {
  const { points, bounds } = replay;
  const duration = bounds.endedAt - bounds.startedAt;
  const geometry = useMemo(() => buildReplayGeometry(points, bounds), [points, bounds]);
  const { controller, state, refresh, reducedMotion } = useReplayPlayback(duration);
  const [scrubbing, setScrubbing] = useState(false);
  const [mapInteracting, setMapInteracting] = useState(false);
  const timestamp = bounds.startedAt + state.elapsedMs;
  const telemetry = telemetryAt(points, timestamp);
  const seek = (ms: number) => { controller.seek(ms); refresh(); };
  return (
    <ScrollView scrollEnabled={!scrubbing && !mapInteracting} contentContainerStyle={styles.content}>
      <View style={styles.heading}>
        <Chip label={replay.partial ? 'Partial flight' : 'Saved replay'} tone={replay.partial ? 'warning' : 'muted'} />
      </View>
      {replay.partial ? <Notice tone="warning">Only the saved portion of this flight is replayed.</Notice> : null}
      <ReplayMap replay={replay} geometry={geometry} telemetry={telemetry} onInteractionChange={setMapInteracting} />
      <View style={styles.readouts}>
        <Readout label="Elapsed" value={replayTime(state.elapsedMs)} />
        <Readout label="GPS altitude" value={formatMetres(telemetry?.altitude ?? null)} />
        <Readout label="Ground speed" value={formatGroundSpeed(telemetry?.speed ?? null)} />
      </View>
      <Text style={styles.availability}>{telemetry ? '— means telemetry unavailable' : 'GPS unavailable at this time'}</Text>
      <SectionLabel>GPS altitude</SectionLabel>
      <Text style={styles.caption}>{geometry.minAltitude === null ? 'No altitude was recorded. Route playback is still available.' : `${formatMetres(geometry.minAltitude)} minimum · ${formatMetres(geometry.maxAltitude)} maximum`}</Text>
      <ReplayAltitude geometry={geometry} timestamp={timestamp} altitude={telemetry?.altitude ?? null} />
      <ReplayTimeline elapsedMs={state.elapsedMs} durationMs={duration} onSeek={seek} onScrubbing={setScrubbing} />
      <View style={styles.timeRow}><Text style={styles.caption}>0:00:00</Text><Text style={styles.caption}>{replayTime(duration)}</Text></View>
      <View style={styles.seekRow}>
        <Button label="−10 s" accessibilityHint="Seek back ten seconds and pause" className="flex-1" onPress={() => { controller.seekBy(-10_000); refresh(); }} />
        <Button label={state.playing ? 'Pause' : state.elapsedMs >= duration ? 'Play again' : 'Play'} variant="primary" className="flex-1"
          onPress={() => { if (state.playing) controller.pause(); else controller.play(); refresh(); }} />
        <Button label="+10 s" accessibilityHint="Seek forward ten seconds and pause" className="flex-1" onPress={() => { controller.seekBy(10_000); refresh(); }} />
      </View>
      <View style={styles.speeds} accessibilityLabel="Playback speed">
        {REPLAY_SPEEDS.map((speed) => <Pressable key={speed} accessibilityRole="radio" accessibilityLabel={`${speed} times speed`}
          accessibilityState={{ selected: speed === state.speed }}
          onPress={() => { controller.setSpeed(speed); refresh(); }}
          style={[styles.speed, state.speed === speed && styles.selected]}>
          <Text style={[styles.speedText, state.speed === speed && styles.selectedText]}>{speed}×</Text>
        </Pressable>)}
      </View>
      <Text style={styles.caption}>Scrubbing and seeking pause playback. Gaps over 15 seconds stay open. {reducedMotion ? 'Reduced motion: playback advances in steps.' : 'Playback starts only when you press Play.'}</Text>
    </ScrollView>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return <View style={styles.readout}><Text style={styles.caption}>{label}</Text><Text style={styles.value}>{value}</Text></View>;
}
const styles = StyleSheet.create({
  content: { padding: 18, paddingBottom: 40, gap: 12 },
  heading: { gap: 12, alignItems: 'flex-start' },
  caption: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, color: paper.muted },
  readouts: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, padding: 14, backgroundColor: paper.card, borderRadius: 22 },
  readout: { flexGrow: 1, minWidth: 90, gap: 6 },
  value: { fontFamily: fonts.monoSemi, fontSize: 20, color: paper.ink },
  availability: { fontFamily: fonts.sansMedium, fontSize: 12, color: paper.text, minHeight: 18 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -12 },
  seekRow: { flexDirection: 'row', gap: 10 },
  speeds: { flexDirection: 'row', gap: 10 },
  speed: { flex: 1, minHeight: 48, padding: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: paper.card, borderRadius: 14, borderWidth: 1, borderColor: paper.border },
  selected: { backgroundColor: paper.ink, borderColor: paper.ink },
  speedText: { fontFamily: fonts.monoSemi, fontSize: 16, color: paper.ink },
  selectedText: { color: paper.onDark },
});
