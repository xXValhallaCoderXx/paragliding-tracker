import {
  trackPlateAccessibilityLabel,
  trackPlateLabels,
  trackPlateState,
} from '../track-presentation';
import { buildTrackPlate } from '@/lib/track/plate';
import type { FlightMetricsRecord, FlightSummary } from '@/recorder/types';

const TRACK = [[46.5, 11.5, 46.51, 11.52, 46.52, 11.55]];

function metrics(overrides: Partial<FlightMetricsRecord> = {}): FlightMetricsRecord {
  return {
    flightId: 'f1',
    algorithmVersion: 1,
    durationMs: 3_600_000,
    trackDistanceMetres: 52_400,
    minGpsAltitude: 400,
    maxGpsAltitude: 2_410,
    maxGroundSpeed: 14,
    fixCount: 11_486,
    medianSourceGapMs: 1_000,
    p95SourceGapMs: 1_000,
    maxSourceGapMs: 1_000,
    quality: 'healthy',
    computedAt: 0,
    ...overrides,
  };
}

function flight(overrides: Partial<FlightSummary> = {}): FlightSummary {
  return {
    id: 'f1',
    recordingSessionId: 's1',
    status: 'completed',
    startedAt: Date.UTC(2026, 7, 16, 6, 42),
    endedAt: Date.UTC(2026, 7, 16, 9, 54),
    // Negative for east of UTC: the field follows Date#getTimezoneOffset, which counts
    // minutes *behind* UTC, so Jakarta at UTC+7 is -420.
    timezoneOffsetMinutes: -420,
    metrics: metrics(),
    ...overrides,
  } as FlightSummary;
}

describe('trackPlateState', () => {
  it('is ready for a finished flight with a shape', () => {
    expect(trackPlateState(flight(), TRACK)).toBe('ready');
  });

  it('is recording while the flight is still in the air', () => {
    expect(trackPlateState(flight({ status: 'recording', endedAt: null }), [])).toBe('recording');
  });

  it('is processing for a landed flight whose stats have not arrived', () => {
    // Both halves matter: the explicit status, and a flight whose finalize was interrupted
    // and left no metrics behind.
    expect(trackPlateState(flight({ status: 'processing' }), [])).toBe('processing');
    expect(trackPlateState(flight({ metrics: null }), [])).toBe('processing');
  });

  it('reports no track when the recording had none', () => {
    expect(trackPlateState(flight({ metrics: metrics({ quality: 'no_track' }) }), [])).toBe(
      'no_track',
    );
  });

  it('draws a stored shape even when the quality verdict says otherwise', () => {
    // 'no_track' is a judgement about whether the recording is usable evidence. A shape
    // that exists is a fact, and refusing to draw one the pilot can see would be stranger
    // than drawing it.
    expect(trackPlateState(flight({ metrics: metrics({ quality: 'no_track' }) }), TRACK)).toBe(
      'ready',
    );
  });
});

describe('trackPlateLabels', () => {
  it('names both moments in the flight’s own local time', () => {
    // The flight's recorded offset, not the phone's — a logbook read at home must still
    // show the times the pilot flew.
    expect(trackPlateLabels(flight())).toEqual({
      takeoff: 'TAKEOFF 13:42',
      landing: 'LANDED 16:54',
    });
  });

  it('has no landing time for a flight still in the air', () => {
    expect(trackPlateLabels(flight({ endedAt: null })).landing).toBeNull();
  });
});

describe('trackPlateAccessibilityLabel', () => {
  it('carries the distance a sighted pilot reads off the shape', () => {
    const plate = buildTrackPlate({ segments: TRACK, variant: 'hero', state: 'ready' });
    expect(trackPlateAccessibilityLabel(flight(), plate)).toContain('52.4');
  });

  it('mentions a break in the recording', () => {
    const plate = buildTrackPlate({
      segments: [[46.5, 11.5, 46.51, 11.52], [46.6, 11.6, 46.61, 11.62]],
      variant: 'hero',
      state: 'ready',
    });
    expect(trackPlateAccessibilityLabel(flight(), plate)).toContain('gap');
  });

  it('explains an empty plate rather than describing a picture that is not there', () => {
    const plate = buildTrackPlate({ segments: [], variant: 'hero', state: 'no_track' });
    expect(trackPlateAccessibilityLabel(flight(), plate)).toBe(
      "Map of this flight's track: no track recorded",
    );
  });

  it('says nothing at all when nothing renders', () => {
    expect(trackPlateAccessibilityLabel(flight(), { kind: 'none' })).toBe('');
  });
});
