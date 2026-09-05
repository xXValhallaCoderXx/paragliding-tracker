import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

import { CHART_VIEW, markerAt, ROUTE_VIEW, type ReplayGeometry } from '@/lib/replay/geometry';
import type { ReplayTelemetry } from '@/lib/replay/model';
import { paper } from '@/ui/theme';

/** Native static path nodes retain their props during animation. */
const RouteDrawing = memo(function RouteDrawing({ geometry }: { geometry: ReplayGeometry }) {
  const start = geometry.projected[0]!;
  const end = geometry.projected[geometry.projected.length - 1]!;
  return <>
    <Path d={geometry.grid.d} stroke={paper.grid} strokeDasharray={[3, 5]} fill="none" />
    <Path d={geometry.routePath} stroke={paper.thermal} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <Circle cx={start.x} cy={start.y} r={6} fill={paper.card} stroke={paper.ink} strokeWidth={2} />
    <Rect x={end.x - 5} y={end.y - 5} width={10} height={10} rx={1} fill={paper.ink} />
  </>;
});

export function ReplayRoute({ geometry, telemetry }: { geometry: ReplayGeometry; telemetry: ReplayTelemetry | null }) {
  const marker = markerAt(geometry.projected, telemetry);
  return (
    <View style={[styles.frame, { aspectRatio: ROUTE_VIEW.width / ROUTE_VIEW.height }]}
      accessible accessibilityRole="image" accessibilityLabel="Recorded route on an offline grid. Circle is first fix, square is last fix. Blue pilot marker follows elapsed time; gaps are left open.">
      <Svg width="100%" height="100%" viewBox={`0 0 ${ROUTE_VIEW.width} ${ROUTE_VIEW.height}`}>
        <RouteDrawing geometry={geometry} />
        {marker ? <Circle cx={marker.x} cy={marker.y} r={7} fill={paper.altitude} stroke={paper.card} strokeWidth={3} /> : null}
      </Svg>
    </View>
  );
}

const AltitudeDrawing = memo(function AltitudeDrawing({ path }: { path: string }) {
  return <Path d={path} stroke={paper.altitude} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />;
});

export function ReplayAltitude({ geometry, timestamp, altitude }: { geometry: ReplayGeometry; timestamp: number; altitude: number | null }) {
  const x = geometry.chartX(timestamp);
  return (
    <View style={[styles.chart, { aspectRatio: CHART_VIEW.width / CHART_VIEW.height }]}
      accessible accessibilityRole="image" accessibilityLabel="GPS altitude over elapsed time. Missing altitude and recording gaps break the chart. The cursor is synchronized with the route.">
      <Svg width="100%" height="100%" viewBox={`0 0 ${CHART_VIEW.width} ${CHART_VIEW.height}`}>
        <Line x1={CHART_VIEW.padding} x2={CHART_VIEW.width - CHART_VIEW.padding} y1={CHART_VIEW.height - CHART_VIEW.padding} y2={CHART_VIEW.height - CHART_VIEW.padding} stroke={paper.border} />
        <AltitudeDrawing path={geometry.chartPath} />
        <Line x1={x} x2={x} y1={CHART_VIEW.padding} y2={CHART_VIEW.height - CHART_VIEW.padding} stroke={paper.ink} strokeDasharray={[3, 3]} />
        {altitude !== null ? <Circle cx={x} cy={geometry.chartY(altitude)} r={4} fill={paper.altitude} stroke={paper.card} strokeWidth={2} /> : null}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', backgroundColor: paper.hairline, borderRadius: 22, overflow: 'hidden' },
  chart: { width: '100%', backgroundColor: paper.card, borderRadius: 14, overflow: 'hidden' },
});
