import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { FlightMap, isFlightMapAvailable } from '@/components/flight-map';
import type { LiveCameraIntent } from '@/components/flight-map/types';
import { buildLiveMapTrack, liveMapPosition, livePositionIsStale } from '@/lib/live/map-model';
import type { LiveMapData } from '@/lib/live/types';
import { cameraForTrack, projectMapCoordinate } from '@/lib/track/map-camera';
import type { FlightMapTrack, MapCoordinate } from '@/lib/track/map-geometry';
import { graticulePath, toPathData } from '@/lib/track/projection';
import type { CaptureHealth } from '@/recorder/types';
import { fonts, paper } from '@/ui/theme';

export const LIVE_MAP_LOAD_TIMEOUT_MS = 15_000;

export interface LiveMapProps {
  data: LiveMapData;
  now: number;
  captureHealth: CaptureHealth;
  camera: LiveCameraIntent;
  onCameraChange: (camera: LiveCameraIntent) => void;
}

/** A disposable view of already captured evidence. It never owns a location subscription. */
export function LiveMap(props: LiveMapProps) {
  return <LiveMapSession key={props.data.sessionId} {...props} />;
}

function LiveMapSession({ data, now, captureHealth, camera, onCameraChange }: LiveMapProps) {
  // The bounded cache publishes at most once a second. Age-only recorder updates do
  // not reconstruct or resend the route to the native map between those publications.
  const track = useMemo(() => buildLiveMapTrack(data, data.observedAt), [data]);
  const fix = liveMapPosition(data, data.observedAt);
  const position = useMemo<MapCoordinate | null>(() => {
    const captured = liveMapPosition(data, data.observedAt);
    return captured ? [captured.longitude, captured.latitude] : null;
  }, [data]);
  const stale = Boolean(fix && (data.readError || livePositionIsStale(fix, now, captureHealth === 'healthy')));
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const fail = useCallback(() => setFailed(true), []);
  const showMap = isFlightMapAvailable && !failed && track !== null && position !== null;
  const age = (timestamp: number) => `${Math.max(0, Math.floor((now - timestamp) / 1000))}s`;
  const recenter = () => {
    if (position && !stale) onCameraChange({ mode: 'follow', center: position, zoom: camera.zoom });
  };
  const retry = () => { setFailed(false); setAttempt((value) => value + 1); };

  return <View style={styles.section} testID="live-map">
    <Text style={[styles.evidence, stale && styles.staleText]} accessibilityLiveRegion="polite">
      {fix ? `${stale ? 'Last known position' : 'Recorded position'} · fix ${age(fix.sourceTimestamp)} old · received ${age(fix.receiptTimestamp)} ago` : 'Waiting for a recorded position'}
    </Text>
    {data.readError ? <Text style={styles.staleText} accessibilityRole="alert">Map data unavailable. Last recorded evidence is retained; recording controls remain available.</Text> : null}
    {failed || !isFlightMapAvailable ? <View style={styles.fallback}>
      <Text style={styles.evidence}>{failed ? "Map couldn't load · Grid" : 'Map unavailable · Grid'}</Text>
      {failed ? <Pressable accessibilityRole="button" accessibilityLabel="Retry map" onPress={retry} style={styles.retry}>
        <Text style={styles.controlText}>Retry map</Text>
      </Pressable> : null}
    </View> : null}
    <View style={styles.viewport}>
      {showMap ? <LiveMapAttempt key={attempt} track={track} position={position} stale={stale}
        camera={camera} onCameraChange={onCameraChange} onError={fail} />
        : <LiveGrid track={track} position={position} stale={stale} />}
      {showMap ? <Pressable accessibilityRole="button" accessibilityLabel="Recenter map"
        accessibilityHint={stale ? 'Available when the recorder has a fresh position' : 'Follow the latest recorded position at the current zoom'}
        accessibilityState={{ disabled: stale }} disabled={stale}
        onPress={recenter} style={[styles.recenter, stale && styles.disabled]}>
        <Svg width={24} height={24} viewBox="0 0 24 24" accessible={false} pointerEvents="none">
          <Circle cx={12} cy={12} r={7} fill="none" stroke={paper.ink} strokeWidth={2} />
          <Circle cx={12} cy={12} r={2} fill={paper.ink} />
          <Path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke={paper.ink} strokeWidth={2} strokeLinecap="round" />
        </Svg>
      </Pressable> : null}
    </View>
    <Text style={styles.caption}>Recent trail{!showMap ? ' · Grid overview' : stale ? ' · Last known position' : camera.mode === 'follow' ? ' · Following recorded position' : ' · Map moved · tap Recenter to follow'}</Text>
  </View>;
}

function LiveMapAttempt({ track, position, stale, camera, onCameraChange, onError }: {
  track: FlightMapTrack;
  position: MapCoordinate;
  stale: boolean;
  camera: LiveCameraIntent;
  onCameraChange: (camera: LiveCameraIntent) => void;
  onError: () => void;
}) {
  const mounted = useRef(true);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    mounted.current = true;
    const timeout = ready ? undefined : setTimeout(() => { if (mounted.current) onError(); }, LIVE_MAP_LOAD_TIMEOUT_MS);
    return () => { mounted.current = false; clearTimeout(timeout); };
  }, [ready, onError]);
  const loaded = useCallback(() => { if (mounted.current) setReady(true); }, []);
  const failed = useCallback(() => { if (mounted.current) onError(); }, [onError]);
  const moved = useCallback((next: LiveCameraIntent) => { if (mounted.current) onCameraChange(next); }, [onCameraChange]);
  return <View style={styles.mapAttempt}>
    <FlightMap track={track} pilotPosition={position} pilotStale={stale} fillContainer
      liveCamera={camera} onLiveCameraChange={moved}
      accessibilityLabel={`Recent recorded route on a north-up map. ${stale ? 'Outlined marker is the last known position.' : 'Blue marker is the latest recorded position.'} Gaps stay open.`}
      onReady={loaded} onError={failed} />
    {!ready ? <Text style={styles.loading} accessibilityLiveRegion="polite">Loading map…</Text> : null}
  </View>;
}

/** Fits the retained segmented route; no interpolation or fabricated endpoints. */
export function LiveGrid({ track, position, stale }: {
  track: FlightMapTrack | null;
  position: MapCoordinate | null;
  stale: boolean;
}) {
  const [size, setSize] = useState({ width: 360, height: 280 });
  const geometry = useMemo(() => {
    const mapCamera = track ? cameraForTrack(track.bounds, size.width, size.height) : { centerCoordinate: [0, 0] as MapCoordinate, zoomLevel: 14 };
    const project = (coordinate: MapCoordinate) => projectMapCoordinate(coordinate, mapCamera, size.width, size.height);
    const unitsPerMetre = 512 * 2 ** mapCamera.zoomLevel /
      (40_075_016.686 * Math.max(0.01, Math.cos(mapCamera.centerCoordinate[1] * Math.PI / 180)));
    return { camera: mapCamera,
      path: toPathData(track?.segments.map((segment) => segment.map(project)) ?? []),
      isolated: track?.isolatedPoints.map(project) ?? [],
      grid: graticulePath({ ...size, padding: 0 }, unitsPerMetre) };
  }, [track, size]);
  const marker = position ? projectMapCoordinate(position, geometry.camera, size.width, size.height) : null;
  return <View style={styles.grid} testID="live-map-grid" accessible accessibilityRole="image"
    accessibilityLabel={`Recent recorded route on an offline grid. ${stale ? 'Outlined marker is the last known position.' : 'Blue marker is the latest recorded position.'} Recording gaps stay open.`}
    onLayout={({ nativeEvent: { layout } }) => {
      if (layout.width > 0 && layout.height > 0) setSize((previous) =>
        previous.width === layout.width && previous.height === layout.height ? previous : { width: layout.width, height: layout.height });
    }}>
    <Svg width="100%" height="100%" viewBox={`0 0 ${size.width} ${size.height}`}>
      <Path d={geometry.grid.d} stroke={paper.grid} strokeDasharray={[3, 5]} fill="none" />
      <Path d={geometry.path} stroke={paper.thermal} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {geometry.isolated.map((point, index) => <Circle key={index} cx={point.x} cy={point.y} r={3} fill={paper.thermal} />)}
      {marker ? <Circle cx={marker.x} cy={marker.y} r={7} fill={stale ? paper.card : paper.altitude}
        stroke={stale ? paper.warnInk : paper.card} strokeWidth={3} /> : null}
    </Svg>
  </View>;
}

const styles = StyleSheet.create({
  section: { flex: 1, gap: 5, minHeight: 0 },
  viewport: { flex: 1, minHeight: 0, position: 'relative' },
  mapAttempt: { flex: 1 },
  grid: { flex: 1, backgroundColor: paper.hairline, borderRadius: 22, overflow: 'hidden' },
  evidence: { fontFamily: fonts.sansMedium, color: paper.ink, fontSize: 12, lineHeight: 17 },
  staleText: { fontFamily: fonts.sansMedium, color: paper.warnInk, fontSize: 12, lineHeight: 17 },
  caption: { fontFamily: fonts.sans, color: paper.muted, fontSize: 11, lineHeight: 15 },
  fallback: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  retry: { minWidth: 96, minHeight: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: paper.card, borderRadius: 12 },
  controlText: { fontFamily: fonts.sansSemi, color: paper.ink, fontSize: 13 },
  recenter: { position: 'absolute', bottom: 12, right: 12, width: 48, height: 48, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center', backgroundColor: paper.card, borderWidth: 1, borderColor: paper.border, elevation: 3 },
  disabled: { opacity: 0.45 },
  loading: { position: 'absolute', top: 8, left: 8, color: paper.ink, backgroundColor: paper.card,
    fontFamily: fonts.sans, fontSize: 12, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8 },
});
