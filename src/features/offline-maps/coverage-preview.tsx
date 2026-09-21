import { Component, useCallback, useEffect, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { loadMapboxSdk } from '@/components/flight-map/sdk';
import { Button, Notice } from '@/components/ui';
import type { OfflineRegionSpec } from '@/offline-maps/types';
import { fonts, paper } from '@/ui/theme';

type MapboxSdk = typeof import('@rnmapbox/maps');

class PreviewBoundary extends Component<{ children: ReactNode; onError: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onError(); }
  render() { return this.state.failed ? null : this.props.children; }
}

export function CoveragePreview({ spec }: { spec: OfflineRegionSpec }) {
  const [sdk, setSdk] = useState<MapboxSdk | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const onError = useCallback(() => setFailed(true), []);
  useEffect(() => {
    let active = true;
    void loadMapboxSdk().then((loaded) => { if (active) setSdk(loaded); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [attempt]);
  if (failed) return <View style={styles.group}>
    <Notice tone="warning" title="Map preview unavailable">Check your connection, then retry to inspect the download area.</Notice>
    <Button label="Retry preview" onPress={() => { setFailed(false); setSdk(null); setAttempt((value) => value + 1); }} />
  </View>;
  if (!sdk) return <View style={styles.loading}><ActivityIndicator color={paper.thermal} /><Text style={styles.hint}>Opening coverage preview…</Text></View>;
  return <PreviewBoundary key={attempt} onError={onError}>
    <NativeCoverage sdk={sdk} spec={spec} onError={onError} />
  </PreviewBoundary>;
}

function NativeCoverage({ sdk, spec, onError }: { sdk: MapboxSdk; spec: OfflineRegionSpec; onError: () => void }) {
  const camera = useRef<ComponentRef<MapboxSdk['Camera']>>(null);
  const [ready, setReady] = useState(false);
  const [laidOut, setLaidOut] = useState(false);
  const [west, south, east, north] = spec.bounds;
  const fit = () => camera.current?.fitBounds([east, north], [west, south], 38, 0);
  useEffect(() => {
    if (!ready || !laidOut) return;
    camera.current?.fitBounds([east, north], [west, south], 38, 0);
  }, [ready, laidOut, west, south, east, north]);
  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(onError, 15_000);
    return () => clearTimeout(timer);
  }, [ready, onError]);
  const coverage: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] };
  return <View style={styles.group}>
    <View style={styles.mapFrame} onLayout={({ nativeEvent }) => setLaidOut(nativeEvent.layout.width > 0 && nativeEvent.layout.height > 0)}>
      <sdk.MapView style={StyleSheet.absoluteFill} styleURL={spec.styleURL} projection="mercator"
        accessibilityLabel={`Download coverage for ${spec.name}`} logoEnabled attributionEnabled compassEnabled={false}
        rotateEnabled={false} pitchEnabled={false} onDidFinishLoadingStyle={() => setReady(true)} onMapLoadingError={onError}>
        <sdk.Camera ref={camera} defaultSettings={{ bounds: { ne: [east, north], sw: [west, south] }, padding: { paddingTop: 38, paddingBottom: 38, paddingLeft: 38, paddingRight: 38 } }} />
        <sdk.ShapeSource id="offline-coverage" shape={coverage}>
          <sdk.FillLayer id="offline-coverage-fill" style={{ fillColor: paper.thermal, fillOpacity: 0.15 }} />
          <sdk.LineLayer id="offline-coverage-edge" style={{ lineColor: paper.thermal, lineWidth: 2 }} />
        </sdk.ShapeSource>
      </sdk.MapView>
    </View>
    <Text style={styles.hint}>The shaded rectangle is the area to save. Moving the map does not change it.</Text>
    <Button label="Fit coverage" variant="ghost" disabled={!ready} onPress={fit} />
  </View>;
}

const styles = StyleSheet.create({
  group: { gap: 8 }, mapFrame: { height: 260, borderRadius: 14, overflow: 'hidden', backgroundColor: paper.cardAlt },
  loading: { height: 140, alignItems: 'center', justifyContent: 'center', gap: 12 },
  hint: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 17, color: paper.muted },
});
