import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { FlightMap, isFlightMapAvailable } from '@/components/flight-map';
import { Button, Notice } from '@/components/ui';
import { formatMetres } from '@/lib/format/flight-format';
import type { ReplayGeometry } from '@/lib/replay/geometry';
import { buildReplayMapTrack, replayMapPosition } from '@/lib/replay/map-model';
import type { FlightReplay, ReplayTelemetry } from '@/lib/replay/model';
import type { FlightMapTrack, MapCoordinate } from '@/lib/track/map-geometry';
import { fonts, paper } from '@/ui/theme';
import { ReplayRoute } from './replay-plots';

export const MAP_LOAD_TIMEOUT_MS = 15_000;

/** Adapts saved fixes to a renderer without owning playback or recorder state. */
export function ReplayMap({ replay, geometry, telemetry, onInteractionChange }: {
  replay: Extract<FlightReplay, { kind: 'available' }>;
  geometry: ReplayGeometry;
  telemetry: ReplayTelemetry | null;
  onInteractionChange: (active: boolean) => void;
}) {
  const track = useMemo(() => buildReplayMapTrack(replay.points, replay.flightId), [replay.points, replay.flightId]);
  const available = isFlightMapAvailable && track !== null;
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [fitRequest, setFitRequest] = useState(0);
  const [foreground, setForeground] = useState(() => AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  const showMap = available && !failed && foreground;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active');
      if (state !== 'active') onInteractionChange(false);
    });
    return () => { subscription.remove(); onInteractionChange(false); };
  }, [onInteractionChange]);

  const fail = useCallback(() => {
    setFailed(true);
    onInteractionChange(false);
  }, [onInteractionChange]);
  const retryMap = () => {
    if (!available || !failed) return;
    setFailed(false);
    setAttempt((value) => value + 1);
    onInteractionChange(false);
  };

  return <View style={styles.section}>
    {!available ? <Notice title="Map unavailable">Your saved route is shown on a grid.</Notice> : null}
    {failed ? <View style={styles.section}>
      <Notice title="Map couldn't load">Your saved replay is available on the grid.</Notice>
      <Button label="Retry map" onPress={retryMap} />
    </View> : null}
    {showMap ? <MapAttempt key={attempt} track={track} pilotPosition={replayMapPosition(replay.points, telemetry)}
      fitRequest={fitRequest} onFit={() => setFitRequest((value) => value + 1)}
      onError={fail} onInteractionChange={onInteractionChange} />
      : <ReplayRoute geometry={geometry} telemetry={telemetry} />}
    <Text style={styles.caption}>○ First fix · {showMap ? '●' : '■'} Last fix · Blue pilot{!showMap && geometry.grid.spacingMetres ? ` · Grid ${formatMetres(geometry.grid.spacingMetres)}` : ''}</Text>
  </View>;
}

/** A new attempt owns its timeout and ignores callbacks after it is replaced. */
function MapAttempt({ track, pilotPosition, fitRequest, onFit, onError, onInteractionChange }: {
  track: FlightMapTrack;
  pilotPosition: MapCoordinate | null;
  fitRequest: number;
  onFit: () => void;
  onError: () => void;
  onInteractionChange: (active: boolean) => void;
}) {
  const [ready, setReady] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const timeout = ready ? undefined : setTimeout(() => { if (mounted.current) onError(); }, MAP_LOAD_TIMEOUT_MS);
    return () => { mounted.current = false; clearTimeout(timeout); };
  }, [ready, onError]);
  const loaded = useCallback(() => { if (mounted.current) setReady(true); }, []);
  const failed = useCallback(() => { if (mounted.current) onError(); }, [onError]);
  const interaction = useCallback((active: boolean) => { if (mounted.current) onInteractionChange(active); }, [onInteractionChange]);
  return <>
    <View style={styles.mapContainer}>
      <FlightMap track={track} pilotPosition={pilotPosition} fitRequest={fitRequest}
        accessibilityLabel="Recorded route on a geographic map. Outlined marker is first fix, filled marker is last fix. Blue pilot follows elapsed time; recording gaps stay open."
        onReady={loaded} onError={failed} onInteractionChange={interaction} />
      <Pressable accessibilityRole="button" accessibilityLabel="Fit flight"
        accessibilityHint="Show the entire recorded route on the map" onPress={onFit}
        style={({ pressed }) => [styles.fitControl, pressed && styles.fitControlPressed]}>
        <Svg width={24} height={24} viewBox="0 0 24 24" accessible={false} pointerEvents="none">
          <Circle cx={12} cy={12} r={7} fill="none" stroke={paper.ink} strokeWidth={2} />
          <Circle cx={12} cy={12} r={2} fill={paper.ink} />
          <Path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke={paper.ink} strokeWidth={2} strokeLinecap="round" />
        </Svg>
      </Pressable>
    </View>
    {!ready ? <Text style={styles.caption} accessibilityLiveRegion="polite">Loading map…</Text> : null}
  </>;
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  mapContainer: { position: 'relative' },
  fitControl: {
    position: 'absolute', right: 12, bottom: 12, width: 48, height: 48, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center', backgroundColor: paper.card,
    borderWidth: 1, borderColor: paper.border, elevation: 3,
    shadowColor: paper.ink, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.16, shadowRadius: 4,
  },
  fitControlPressed: { opacity: 0.75 },
  caption: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, color: paper.muted },
});
