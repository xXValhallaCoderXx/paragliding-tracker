import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { MAPBOX_PUBLIC_ACCESS_TOKEN } from '@/components/flight-map/config';
import { buildTrackPlate } from '@/lib/track/plate';
import { buildStaticMapPreview } from '@/lib/track/static-map';
import { fonts, paper } from '@/ui/theme';
import { TrackPlate } from './track-plate';

type PreviewProps = ComponentProps<typeof TrackPlate> & { enabled?: boolean };
type Preview = NonNullable<ReturnType<typeof buildStaticMapPreview>>;
export const STATIC_MAP_TIMEOUT_MS = 15_000;

/** One static image with a local route overlay; never mounts a native map or a pilot. */
export function FlightMapPreview({ enabled = true, ...plateProps }: PreviewProps) {
  const { segments, state, describe } = plateProps;
  // The React Compiler memoizes this from the stable stored-track props.
  const preview = enabled && state === 'ready'
    ? buildStaticMapPreview(segments, MAPBOX_PUBLIC_ACCESS_TOKEN) : null;
  const fallback = <TrackPlate {...plateProps} takeoffLabel={plateProps.takeoffLabel ?? 'Start'}
    landingLabel={plateProps.landingLabel ?? (state === 'ready' ? 'Stop' : null)} />;
  if (!preview) return fallback;
  const description = describe
    ? `${describe(buildTrackPlate(plateProps))}. Start is an outlined circle; stop is a filled square.`
    : undefined;
  return <StaticPreview key={preview.url} preview={preview} description={description} fallback={fallback} />;
}

function StaticPreview({ preview, description, fallback }: {
  preview: Preview;
  description?: string;
  fallback: React.ReactNode;
}) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  // Mapbox permits a 12-hour client cache. A later mount uses a fresh disk-cache key;
  // the platform image cache owns eviction rather than an app-wide cache clear.
  const [cachePeriod] = useState(() => Math.floor(Date.now() / 43_200_000));
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    const timer = status === 'loading'
      ? setTimeout(() => { if (active.current) setStatus('failed'); }, STATIC_MAP_TIMEOUT_MS) : undefined;
    return () => { active.current = false; clearTimeout(timer); };
  }, [status]);
  if (status === 'failed') return fallback;

  const { width, height } = preview.view;
  const ready = status === 'ready';
  const finish = (next: 'ready' | 'failed') => {
    if (active.current) setStatus((current) => current === 'failed' ? current : next);
  };
  return <View style={{ width: '100%', aspectRatio: width / height }}
    accessible={ready && Boolean(description)} accessibilityRole={description ? 'image' : 'none'}
    accessibilityLabel={ready ? description : undefined}>
    {!ready ? fallback : null}
    <View pointerEvents="none" importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, !ready && styles.hidden]}>
      <Image source={{ uri: preview.url, cacheKey: `${preview.url}:${cachePeriod}` }} style={StyleSheet.absoluteFill} contentFit="contain"
        cachePolicy="disk" recyclingKey={preview.url} transition={0} accessible={false}
        onLoad={() => finish('ready')} onError={() => finish('failed')} />
      {ready ? <>
        <Svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`}>
          <Path d={preview.path} fill="none" stroke={paper.card} strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
          <Path d={preview.path} fill="none" stroke={paper.thermal} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
          {preview.isolatedPoints.map((point, index) => <Circle key={index} cx={point.x} cy={point.y}
            r={3} fill={paper.thermal} stroke={paper.card} strokeWidth={1.5} />)}
          <Circle cx={preview.start.x} cy={preview.start.y} r={7} fill={paper.card} stroke={paper.ink} strokeWidth={2} />
          <Rect x={preview.stop.x - 4} y={preview.stop.y - 4} width={8} height={8} rx={1}
            fill={paper.thermal} stroke={paper.card} strokeWidth={1.5} />
        </Svg>
        <EndpointLabel text="Start" point={preview.start} view={preview.view} above />
        <EndpointLabel text="Stop" point={preview.stop} view={preview.view} />
      </> : null}
    </View>
  </View>;
}

function EndpointLabel({ text, point, view, above = false }: {
  text: string; point: { x: number; y: number }; view: { width: number; height: number }; above?: boolean;
}) {
  // Separate labels above/below even when a walk starts and stops at the same position.
  const x = Math.max(30, Math.min(view.width - 30, point.x));
  const y = Math.max(24, Math.min(view.height - 44, point.y + (above ? -25 : 13)));
  return <View style={[styles.endpoint, { left: `${x / view.width * 100}%`, top: `${y / view.height * 100}%` }]}>
    <Text style={styles.endpointText}>{text}</Text>
  </View>;
}

const styles = StyleSheet.create({
  hidden: { opacity: 0 },
  endpoint: {
    position: 'absolute', width: 54, marginLeft: -27, alignItems: 'center', paddingVertical: 2,
    borderRadius: 6, backgroundColor: paper.card, borderWidth: 1, borderColor: paper.border,
  },
  endpointText: { fontFamily: fonts.sansSemi, fontSize: 11, lineHeight: 15, color: paper.ink },
});
