import { flight as makeFlight, metrics as makeMetrics } from '../../../../tests/support/fixtures';
import type { FlightMetricsRecord, FlightSummary } from '@/recorder/types';

import {
  buildLogbookLayout,
  flightInsight,
  flightInsightText,
  seasonSummary,
} from '../logbook';

const HOUR = 3_600_000;

const metrics = (overrides: Partial<FlightMetricsRecord> = {}) => makeMetrics({
  flightId: 'f', trackDistanceMetres: 10_000, maxGpsAltitude: 1200, maxGroundSpeed: 12,
  fixCount: 3600, maxSourceGapMs: 2000, ...overrides,
});
function flight(overrides: Partial<FlightSummary> & { id: string }): FlightSummary {
  const startedAt = overrides.startedAt ?? Date.UTC(2026, 7, 16, 6, 42);
  return makeFlight({
    recordingSessionId: `session-${overrides.id}`, startedAt, endedAt: startedAt + HOUR,
    createdAt: startedAt, updatedAt: startedAt, metrics: metrics({ flightId: overrides.id }), ...overrides,
  });
}

describe('buildLogbookLayout', () => {
  it('pins the unfinished flight and groups the rest by recorded month, newest first', () => {
    const layout = buildLogbookLayout([
      flight({ id: 'jul', startedAt: Date.UTC(2026, 6, 12, 5, 0) }),
      flight({
        id: 'open',
        startedAt: Date.UTC(2026, 7, 17, 8, 0),
        status: 'recording',
        sessionStatus: 'interrupted',
        endedAt: null,
        metrics: null,
      }),
      flight({ id: 'aug-a', startedAt: Date.UTC(2026, 7, 16, 6, 42) }),
      flight({ id: 'aug-b', startedAt: Date.UTC(2026, 7, 15, 7, 5) }),
    ]);

    expect(layout.open?.id).toBe('open');
    expect(layout.sections.map((section) => section.title)).toEqual(['August 2026', 'July 2026']);
    expect(layout.sections[0]!.flights.map((entry) => entry.id)).toEqual(['aug-a', 'aug-b']);
    expect(layout.sections[1]!.flights.map((entry) => entry.id)).toEqual(['jul']);
  });

  it('uses the flight timezone for month boundaries', () => {
    // 2026-08-31T20:00Z is already 1 September in UTC+7.
    const layout = buildLogbookLayout([
      flight({ id: 'edge', startedAt: Date.UTC(2026, 7, 31, 20, 0) }),
    ]);
    expect(layout.sections[0]!.title).toBe('September 2026');
  });

  it('returns no pinned flight and no sections for an empty logbook', () => {
    expect(buildLogbookLayout([])).toEqual({ open: null, sections: [] });
  });
});

describe('seasonSummary', () => {
  it('sums only finished flights that have stats', () => {
    const summary = seasonSummary(
      [
        flight({ id: 'a', metrics: metrics({ durationMs: 3 * HOUR, trackDistanceMetres: 52_400 }) }),
        flight({ id: 'b', metrics: metrics({ durationMs: HOUR / 2, trackDistanceMetres: 9_100 }) }),
        flight({ id: 'processing', status: 'processing', metrics: null }),
        flight({
          id: 'open',
          status: 'recording',
          sessionStatus: 'recording',
          endedAt: null,
          metrics: null,
        }),
      ],
      2026,
    );
    expect(summary).toEqual({
      year: 2026,
      airtimeMs: 3.5 * HOUR,
      flightCount: 2,
      longestMs: 3 * HOUR,
      bestDistanceMetres: 52_400,
    });
  });

  it('falls back to the most recent season with flights', () => {
    const summary = seasonSummary(
      [
        flight({ id: 'old', startedAt: Date.UTC(2024, 3, 1, 4, 0) }),
        flight({ id: 'older', startedAt: Date.UTC(2023, 3, 1, 4, 0) }),
      ],
      2026,
    );
    expect(summary?.year).toBe(2024);
    expect(summary?.flightCount).toBe(1);
  });

  it('is null without finished flights', () => {
    expect(seasonSummary([], 2026)).toBeNull();
    expect(
      seasonSummary([flight({ id: 'p', status: 'processing', metrics: null })], 2026),
    ).toBeNull();
  });
});

describe('flightInsight', () => {
  const longest = flight({ id: 'longest', metrics: metrics({ durationMs: 4 * HOUR }) });
  const farthest = flight({
    id: 'farthest',
    metrics: metrics({ durationMs: 2 * HOUR, trackDistanceMetres: 62_000 }),
  });
  const modest = flight({
    id: 'modest',
    site: 'Puncak',
    metrics: metrics({ durationMs: HOUR, trackDistanceMetres: 5_000 }),
  });
  const all = [longest, farthest, modest];

  it('describes firsts, records, and rankings from local data only', () => {
    expect(flightInsight(longest, [longest])).toEqual({ kind: 'first' });
    expect(flightInsight(longest, all)).toEqual({ kind: 'longest' });
    expect(flightInsight(farthest, all)).toEqual({ kind: 'farthest' });
    expect(flightInsight(modest, all)).toEqual({ kind: 'first_at_site', site: 'Puncak' });
    expect(
      flightInsight({ ...modest, site: null }, all),
    ).toEqual({ kind: 'ranked_duration', rank: 3 });
  });

  it('says nothing for unfinished flights or unremarkable ones', () => {
    expect(flightInsight({ ...modest, metrics: null, status: 'processing' }, all)).toBeNull();
    const many = [longest, farthest, ...['a', 'b', 'c'].map((id) =>
      flight({ id, metrics: metrics({ durationMs: 3 * HOUR }) }),
    )];
    expect(flightInsight({ ...modest, site: null }, [...many, { ...modest, site: null }])).toBeNull();
  });

  it('renders each insight as one plain sentence', () => {
    expect(flightInsightText({ kind: 'first' })).toMatch(/first flight/);
    expect(flightInsightText({ kind: 'ranked_duration', rank: 2 })).toMatch(/second-longest/);
    expect(flightInsightText({ kind: 'first_at_site', site: 'Puncak' })).toBe(
      'Your first logged flight from Puncak.',
    );
  });
});
