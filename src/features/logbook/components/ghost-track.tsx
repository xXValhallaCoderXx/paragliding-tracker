import Svg, { Circle, Path } from 'react-native-svg';

import { graticulePath } from '@/lib/track/projection';
import { paper } from '@/ui/theme';

/**
 * The sketch of a flight that has not happened yet.
 *
 * Design 2b draws the empty logbook as a faint, dashed version of the plate a real flight gets:
 * the same graticule, a thermalling track, a takeoff marker. It replaced a dashed square holding
 * a fake "0:00 AIRTIME", which read as a broken widget rather than an invitation.
 *
 * Everything here is decoration. There is no flight to project, so the path is a fixed curve
 * lifted from the design rather than anything derived — which is why it lives beside the
 * component as a constant instead of in `src/lib/track`.
 */

const SIZE = 132;

/** The graticule's own no-track branch, already covered by the projection tests. */
const VIEW = { width: SIZE, height: SIZE, padding: 0 };

/**
 * A climb with three turns in it, ending on glide. Taken from the design's own path so the
 * empty state and the mock agree.
 */
const TRACK =
  'M24 108 C38 88 32 76 46 70 C60 64 64 76 54 80 C46 83 46 70 60 64 ' +
  'C76 57 72 78 84 64 C98 48 94 38 110 28';

const TAKEOFF = { x: 24, y: 108 };

export function GhostTrack() {
  return (
    <Svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      // Decorative: the heading and body text beside it already say what this means, and a
      // screen reader announcing "drawing of a track" would be noise.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <Path
        d={graticulePath(VIEW, 0).d}
        stroke={paper.grid}
        strokeWidth={1}
        // An array, not the CSS string form, which has been unreliable on Android.
        strokeDasharray={[2, 5]}
        fill="none"
      />
      <Path
        d={TRACK}
        stroke={paper.faint}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={[5, 6]}
        fill="none"
      />
      <Circle cx={TAKEOFF.x} cy={TAKEOFF.y} r={4.5} fill={paper.background} stroke={paper.faint} strokeWidth={2} />
    </Svg>
  );
}
