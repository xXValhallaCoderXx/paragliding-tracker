import { Component, memo, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { NativeModules, StyleSheet, View, type GestureResponderEvent } from 'react-native';

import type { FlightMapTrack, MapCoordinate } from '@/lib/track/map-geometry';
import { paper } from '@/ui/theme';

import { cameraForTrack } from './camera';
import { MAPBOX_PUBLIC_ACCESS_TOKEN, MAPBOX_STYLE_URI } from './config';
import type { FlightMapProps, LiveCameraIntent } from './types';

export { MAPBOX_STYLE_URI } from './config';
export type { FlightMapProps, LiveCameraIntent } from './types';

type MapboxSdk = typeof import('@rnmapbox/maps');
export const isFlightMapAvailable = MAPBOX_PUBLIC_ACCESS_TOKEN.startsWith('pk.') && NativeModules.RNMBXModule != null;

let sdkPromise: Promise<MapboxSdk> | undefined;
function loadMapbox(): Promise<MapboxSdk> {
  sdkPromise ??= Promise.resolve().then(async () => {
    if (!isFlightMapAvailable) throw new Error('A newer app build with map configuration is needed.');
    // The installed APK may predate Mapbox. Check its bridge before evaluating the package.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sdk = require('@rnmapbox/maps') as MapboxSdk;
    await sdk.setAccessToken(MAPBOX_PUBLIC_ACCESS_TOKEN);
    return sdk;
  }).catch((error: unknown) => {
    sdkPromise = undefined;
    throw error;
  });
  return sdkPromise;
}

class MapErrorBoundary extends Component<{ children: ReactNode; onError: (message: string) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError('The map could not open. The recorded route is still available on Grid.'); }
  render() { return this.state.failed ? null : this.props.children; }
}

const point = (coordinate: MapCoordinate): GeoJSON.Point => ({ type: 'Point', coordinates: coordinate });

/** Static track sources do not reserialize while the replay pilot moves. */
const TrackLayers = memo(function TrackLayers({ sdk, track }: { sdk: MapboxSdk; track: FlightMapTrack }) {
  const shapes = useMemo(() => ({
    route: { type: 'MultiLineString', coordinates: track.segments } as GeoJSON.MultiLineString,
    isolated: { type: 'MultiPoint', coordinates: track.isolatedPoints } as GeoJSON.MultiPoint,
    first: track.first ? point(track.first) : null,
    last: track.last ? point(track.last) : null,
  }), [track]);
  return <>
    {track.segments.length > 0 ? <sdk.ShapeSource id="flight-route" shape={shapes.route}>
      <sdk.LineLayer id="flight-route-casing" style={routeCasing} />
      <sdk.LineLayer id="flight-route-line" style={routeLine} />
    </sdk.ShapeSource> : null}
    {track.isolatedPoints.length > 0 ? <sdk.ShapeSource id="flight-isolated" shape={shapes.isolated}>
      <sdk.CircleLayer id="flight-isolated-points" style={isolatedStyle} />
    </sdk.ShapeSource> : null}
    {shapes.first ? <sdk.ShapeSource id="flight-first" shape={shapes.first}>
      <sdk.CircleLayer id="flight-first-point" style={firstStyle} />
      <sdk.SymbolLayer id="flight-first-label" style={startLabelStyle} />
    </sdk.ShapeSource> : null}
    {shapes.last ? <sdk.ShapeSource id="flight-last" shape={shapes.last}>
      <sdk.CircleLayer id="flight-last-point" style={lastStyle} />
      <sdk.SymbolLayer id="flight-last-label" style={stopLabelStyle} />
    </sdk.ShapeSource> : null}
  </>;
});

const PilotLayer = memo(function PilotLayer({ sdk, position, stale }: { sdk: MapboxSdk; position: MapCoordinate | null; stale: boolean }) {
  const shape = useMemo(() => position ? point(position) : null, [position]);
  return shape ? <sdk.ShapeSource id="flight-pilot" shape={shape}>
    <sdk.CircleLayer id="flight-pilot-point" style={stale ? stalePilotStyle : pilotStyle} />
  </sdk.ShapeSource> : null;
});

function NativeFlightMap({ sdk, track, pilotPosition, accessibilityLabel, fitRequest = 0,
  liveCamera, onLiveCameraChange, pilotStale = false, fillContainer = false,
  onReady, onError, onInteractionChange }: FlightMapProps & { sdk: MapboxSdk }) {
  const camera = useRef<ComponentRef<MapboxSdk['Camera']>>(null);
  const [layout, setLayout] = useState<{ width: number; height: number } | null>(null);
  const [styleReady, setStyleReady] = useState(false);
  const fitted = useRef<{ trackId: string; fitRequest: number } | null>(null);
  const reportedReady = useRef(false);
  const interacting = useRef(false);
  const gestureCamera = useRef(false);
  const previousLiveMode = useRef(liveCamera?.mode);
  const appliedLiveCamera = useRef<{ id: string; longitude: number; latitude: number; zoom: number } | null>(null);
  const callbacks = useRef({ onReady, onError, onInteractionChange, onLiveCameraChange });
  useEffect(() => { callbacks.current = { onReady, onError, onInteractionChange, onLiveCameraChange }; },
    [onReady, onError, onInteractionChange, onLiveCameraChange]);

  useEffect(() => {
    if (!layout || !styleReady || !camera.current) return;
    if (liveCamera) {
      const resumeFollow = liveCamera.mode === 'follow' && previousLiveMode.current === 'manual';
      previousLiveMode.current = liveCamera.mode;
      // Recenter can arrive before gesture inertia settles. Its newer intent owns
      // the camera; the obsolete idle event must not restore manual mode.
      if (resumeFollow) gestureCamera.current = false;
      const center = liveCamera.mode === 'follow' ? pilotPosition ?? liveCamera.center : liveCamera.center ?? pilotPosition;
      if (!center || gestureCamera.current) return;
      const previous = appliedLiveCamera.current;
      // Stale/recovering capture may deliver delayed rows; keep the existing camera still.
      if (previous?.id === track.id && pilotStale) return;
      // Gesture callbacks already moved the native camera. Reapplying them fights pan/pinch.
      if (previous?.id === track.id && liveCamera.mode === 'manual') return;
      const zoom = Math.max(0, Math.min(18, liveCamera.zoom));
      if (!resumeFollow && previous?.id === track.id && previous.longitude === center[0] && previous.latitude === center[1] && previous.zoom === zoom) return;
      try {
        camera.current.setCamera({ centerCoordinate: center, zoomLevel: zoom,
          heading: 0, pitch: 0, animationDuration: 0, animationMode: 'none' });
        appliedLiveCamera.current = { id: track.id, longitude: center[0], latitude: center[1], zoom };
        fitted.current = { trackId: track.id, fitRequest };
      } catch {
        callbacks.current.onError('The map could not show this position. The recorded route is still available on Grid.');
      }
      return;
    }
    if (fitted.current?.trackId === track.id && fitted.current.fitRequest === fitRequest) return;
    try {
      camera.current.setCamera({ ...cameraForTrack(track.bounds, layout.width, layout.height),
        heading: 0, pitch: 0, animationDuration: 0, animationMode: 'none' });
      fitted.current = { trackId: track.id, fitRequest };
    } catch {
      callbacks.current.onError('The map could not fit this flight. The recorded route is still available on Grid.');
    }
  }, [track, fitRequest, layout, styleReady, liveCamera, pilotPosition, pilotStale]);

  useEffect(() => () => {
    if (interacting.current) callbacks.current.onInteractionChange?.(false);
  }, []);

  const interaction = (active: boolean) => {
    if (interacting.current === active) return;
    interacting.current = active;
    callbacks.current.onInteractionChange?.(active);
  };
  const touchEnd = (event: GestureResponderEvent) => interaction(event.nativeEvent.touches.length > 0);
  const userCamera = (state: Parameters<NonNullable<MapboxSdk['MapView']['prototype']['props']['onCameraChanged']>>[0]) => {
    if (!liveCamera) return;
    const { center, zoom } = state.properties;
    if (!Number.isFinite(center[0]) || !Number.isFinite(center[1]) || !Number.isFinite(zoom)) return;
    const next: LiveCameraIntent = { mode: 'manual', center: [center[0]!, center[1]!], zoom: Math.max(0, Math.min(18, zoom)) };
    appliedLiveCamera.current = { id: track.id, longitude: center[0]!, latitude: center[1]!, zoom: next.zoom };
    callbacks.current.onLiveCameraChange?.(next);
  };

  return <View style={[styles.frame, fillContainer ? styles.fill : styles.preview]} testID="flight-map-frame"
    onLayout={({ nativeEvent: { layout: next } }) => {
      if (next.width > 0 && next.height > 0) setLayout((previous) =>
        previous?.width === next.width && previous.height === next.height ? previous : { width: next.width, height: next.height });
    }}
    onTouchStart={() => interaction(true)} onTouchEnd={touchEnd} onTouchCancel={() => interaction(false)}>
    <sdk.MapView style={styles.map} testID="flight-map-native" accessibilityLabel={accessibilityLabel}
      styleURL={MAPBOX_STYLE_URI} projection="mercator"
      rotateEnabled={false} pitchEnabled={false} zoomEnabled scrollEnabled
      logoEnabled attributionEnabled compassEnabled={false}
      onDidFinishLoadingStyle={() => setStyleReady(true)}
      onCameraChanged={(state) => {
        if (!liveCamera || !state.gestures.isGestureActive) return;
        gestureCamera.current = true;
        userCamera(state);
      }}
      // Android 10.3.5 does not emit DidFinishRenderingMapFully. MapIdle is wired
      // to the SDK event that follows rendering the requested tiles and transitions.
      onMapIdle={(state) => {
        if (gestureCamera.current) {
          if (state) userCamera(state);
          gestureCamera.current = false;
        }
        if (!fitted.current || reportedReady.current) return;
        reportedReady.current = true;
        callbacks.current.onReady();
      }}
      onMapLoadingError={() => callbacks.current.onError('The map background could not load. The recorded route is still available on Grid.')}>
      <sdk.Camera ref={camera} maxZoomLevel={18} />
      <TrackLayers sdk={sdk} track={track} />
      <PilotLayer sdk={sdk} position={pilotPosition} stale={pilotStale} />
    </sdk.MapView>
  </View>;
}

export function FlightMap(props: FlightMapProps) {
  const [sdk, setSdk] = useState<MapboxSdk | null>(null);
  const errorCallback = useRef(props.onError);
  useEffect(() => { errorCallback.current = props.onError; }, [props.onError]);
  useEffect(() => {
    let mounted = true;
    void loadMapbox().then((loaded) => { if (mounted) setSdk(loaded); }, () => {
      if (mounted) errorCallback.current('This app build cannot open the map. The recorded route is still available on Grid.');
    });
    return () => { mounted = false; };
  }, []);
  return sdk ? <MapErrorBoundary onError={props.onError}>
    <NativeFlightMap {...props} sdk={sdk} />
  </MapErrorBoundary> : <View style={[styles.frame, props.fillContainer ? styles.fill : styles.preview]} />;
}

const routeCasing = { lineColor: paper.card, lineWidth: 6, lineJoin: 'round', lineCap: 'round' } as const;
const routeLine = { lineColor: paper.thermal, lineWidth: 3, lineJoin: 'round', lineCap: 'round' } as const;
const isolatedStyle = { circleColor: paper.thermal, circleRadius: 3, circleStrokeColor: paper.card, circleStrokeWidth: 1.5 } as const;
const firstStyle = { circleColor: paper.card, circleRadius: 6, circleStrokeColor: paper.ink, circleStrokeWidth: 2 } as const;
const lastStyle = { circleColor: paper.ink, circleRadius: 5, circleStrokeColor: paper.card, circleStrokeWidth: 2 } as const;
const endpointLabelStyle = {
  textSize: 12, textColor: paper.ink, textHaloColor: paper.card, textHaloWidth: 2,
  textAllowOverlap: true, textIgnorePlacement: true,
} as const;
const startLabelStyle = { ...endpointLabelStyle, textField: 'Start', textAnchor: 'bottom' as const, textOffset: [0, -1] };
const stopLabelStyle = { ...endpointLabelStyle, textField: 'Stop', textAnchor: 'top' as const, textOffset: [0, 1] };
const pilotStyle = { circleColor: paper.altitude, circleRadius: 7, circleStrokeColor: paper.card, circleStrokeWidth: 3 } as const;
const stalePilotStyle = { ...pilotStyle, circleColor: paper.card, circleStrokeColor: paper.warnInk } as const;
const styles = StyleSheet.create({
  frame: { backgroundColor: paper.hairline, borderRadius: 22, overflow: 'hidden' },
  // Select dimensions rather than clearing aspectRatio with undefined: the native
  // CSS processor removes undefined keys before combining the inline style array.
  preview: { width: '100%', aspectRatio: 360 / 280 },
  map: { flex: 1 },
  fill: { width: '100%', flex: 1, minWidth: 0, minHeight: 0 },
});
