import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { buildTrackPlate } from '@/lib/track/plate';
import type {
  PlateLabel,
  TrackPlate as Plate,
  TrackPlateState,
  TrackPlateVariant,
} from '@/lib/track/plate';
import type { TrackSegments } from '@/lib/track/types';
import { fonts, paper } from '@/ui/theme';

/**
 * A flight's track, drawn.
 *
 * No basemap and no tiles, which is a decision rather than a shortcut: launches have no
 * signal, and every tile provider's terms restrict the caching that offline would require.
 * So the plate draws what the app actually recorded, over a graticule that carries a real
 * scale — honest at a mountain launch and identical in airplane mode.
 *
 * Every decision here was made in `@/lib/track/plate`. Jest never collects `.tsx`, so a rule
 * that lived in this file would be a rule nothing checks; this component reads coordinates
 * and chooses nothing.
 */
export function TrackPlate({
  segments,
  variant,
  state,
  takeoffLabel = null,
  landingLabel = null,
  describe,
}: {
  segments: TrackSegments;
  variant: TrackPlateVariant;
  state: TrackPlateState;
  takeoffLabel?: string | null;
  landingLabel?: string | null;
  /**
   * What a screen reader hears. A callback rather than a string because the description
   * depends on what was actually drawn — whether the path broke, whether there is a track
   * at all — and asking the caller for that would mean building the plate twice.
   *
   * Omitted on a thumbnail: the card around it is already one labelled button, and a
   * decorative image inside it would just be a second thing to swipe past.
   */
  describe?: (plate: Plate) => string;
}) {
  // Called in the render body: the React Compiler memoizes it on these props, and `segments`
  // keeps its identity for as long as the RTK Query entry does.
  const plate = buildTrackPlate({ segments, variant, state, takeoffLabel, landingLabel });
  if (plate.kind === 'none') return null;

  const { width, height } = plate.view;
  const isHero = variant === 'hero';

  const description = describe?.(plate) ?? null;

  return (
    <View
      accessible={description !== null}
      accessibilityRole={description === null ? 'none' : 'image'}
      accessibilityLabel={description ?? undefined}
      importantForAccessibility={description === null ? 'no-hide-descendants' : 'auto'}
      style={[
        styles.frame,
        { aspectRatio: width / height },
        isHero ? null : styles.thumbnailFrame,
      ]}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`}>
        <Rect x={0} y={0} width={width} height={height} fill={paper.hairline} />

        {plate.grid ? (
          // One path for the whole graticule. Fourteen <Line> elements would be fourteen
          // native views on a screen that mounts every logbook card at once.
          <Path
            d={plate.grid}
            stroke={paper.grid}
            strokeWidth={1}
            // An array, not the CSS string form, which has been unreliable across versions
            // of this library on Android.
            strokeDasharray={[3, 5]}
            fill="none"
          />
        ) : null}

        {plate.kind === 'track' ? (
          <Path
            d={plate.path}
            stroke={paper.thermal}
            strokeWidth={plate.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        ) : null}

        {plate.kind === 'track' || plate.kind === 'point'
          ? plate.markers.map((marker) =>
              marker.kind === 'takeoff' ? (
                <Circle
                  key={marker.kind}
                  cx={marker.x}
                  cy={marker.y}
                  r={marker.radius}
                  fill={paper.card}
                  stroke={paper.thermal}
                  strokeWidth={plate.kind === 'track' ? plate.strokeWidth : 2.4}
                />
              ) : (
                // Square for the landing, so the two ends are tellable apart without colour.
                <Rect
                  key={marker.kind}
                  x={marker.x - marker.radius}
                  y={marker.y - marker.radius}
                  width={marker.radius * 2}
                  height={marker.radius * 2}
                  rx={1.5}
                  fill={paper.ink}
                />
              ),
            )
          : null}
      </Svg>

      {/*
        Real React Native text over the SVG rather than <SvgText>. Two reasons, both
        Android: react-native-svg resolves fontFamily through its own typeface cache, which
        does not reliably see fonts expo-font loaded at runtime — so these would silently
        fall back to Roboto on a device and nowhere else. And SVG paints fill before stroke
        with no way to reverse it, so a stroked halo would eat into the glyphs it is meant
        to protect.
      */}
      {plate.kind === 'track' || plate.kind === 'point'
        ? plate.labels.map((label) => <PlateCaption key={label.kind} label={label} />)
        : null}

      {plate.caption ? (
        <Text
          style={[styles.badge, plate.kind === 'empty' && plate.tone === 'warning' && styles.badgeWarning]}>
          {plate.caption}
        </Text>
      ) : null}
    </View>
  );
}

function PlateCaption({ label }: { label: PlateLabel }) {
  return (
    <Text
      // Positioned by percentages the pure module already clamped, so nothing here has to
      // measure the SVG or wait for a layout pass.
      style={[
        styles.label,
        { top: `${label.yPercent}%` },
        label.align === 'left' ? { left: `${label.xPercent}%` } : { right: `${100 - label.xPercent}%` },
      ]}>
      {label.text}
    </Text>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', overflow: 'hidden', backgroundColor: paper.hairline },
  thumbnailFrame: { borderRadius: 8 },
  label: {
    position: 'absolute',
    fontFamily: fonts.sansMedium,
    fontSize: 9.5,
    letterSpacing: 0.7,
    color: paper.ink,
    backgroundColor: paper.hairline,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    overflow: 'hidden',
  },
  badge: {
    position: 'absolute',
    top: 10,
    right: 14,
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 1,
    color: paper.ghost,
  },
  badgeWarning: { color: paper.warnInk },
});
