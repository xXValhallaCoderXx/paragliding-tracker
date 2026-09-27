import React from 'react';
import { Text } from 'react-native';
import { Chip } from '@/components/ui';
import { JournalArt } from '@/components/ui/journal-art';
import { FlightMapPreview } from '@/features/flights/components/flight-map-preview';
import type { ArchivedFlightSummary, FlightSummary } from '@/recorder/types';
import type { TrackSegments } from '@/lib/track/types';
import { flight, metrics } from '../../../../tests/support/fixtures';
import { act, create } from '../../../../tests/support/renderer';
import { FlightCard } from '../components/flight-card';
import { JournalSummaryCard } from '../components/journal-summary-card';
import type { JournalSummary } from '../journal-query';

jest.mock('@/components/ui', () => ({ Chip: () => null }));
jest.mock('@/components/ui/journal-art', () => ({ JournalArt: () => null }));
jest.mock('@/features/flights/components/flight-map-preview', () => ({ FlightMapPreview: () => null }));

let rendered: ReturnType<typeof create>;
const route: TrackSegments = [[46, 8, 46.001, 8.002], [46.004, 8.004, 46.005, 8.005]];
const onPress = jest.fn();
const text = () => rendered.root.findAllByType(Text)
  .map((node: { props: { children: React.ReactNode } }) => node.props.children).flat().join(' ');
const chips = () => rendered.root.findAllByType(Chip).map((node: { props: { label: string } }) => node.props.label);
const card = () => rendered.root.findAll((node: { props: { accessibilityRole?: string; onPress?: unknown } }) =>
  node.props.accessibilityRole === 'button' && node.props.onPress === onPress)[0];
const archived = (overrides: Partial<ArchivedFlightSummary> = {}): ArchivedFlightSummary => ({
  ...flight(), source: 'archive', ownerUserId: 'owner', sessionStatus: null,
  archive: { trackState: 'pending', error: null, downloadedAt: null }, ...overrides,
});
async function renderFlight(value: FlightSummary, track: TrackSegments = route) {
  await act(async () => { rendered = create(React.createElement(FlightCard, { flight: value, track,
    mapPreviewEnabled: false, onPress })); });
}
afterEach(async () => { if (rendered) await act(async () => rendered.unmount()); jest.clearAllMocks(); });

it('renders measured values with explicit labels and preserves the exact stored route and preview visibility', async () => {
  await renderFlight(flight({ title: 'Morning at the ridge', metrics: metrics({ durationMs: 2_820_000, trackDistanceMetres: 18_200 }) }));
  expect(text()).toContain('0:47');
  expect(text()).toContain('Recorded time');
  expect(text()).toContain('Track distance');
  expect(text()).toContain('Max GPS altitude');
  expect(chips()).toEqual(['Good track']);
  expect(rendered.root.findByType(FlightMapPreview).props).toMatchObject({ segments: route, enabled: false, state: 'ready' });
  expect(rendered.root.findByType(FlightMapPreview).props.segments).toBe(route);
  card().props.onPress();
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(text()).not.toMatch(/airtime|private|shared|kudos/i);
});

it('explains partial recordings and GPS gaps together without inventing a missing duration or a healthy verdict', async () => {
  await renderFlight(flight({ status: 'partial', metrics: metrics({ quality: 'gaps' }) }));
  expect(chips()).toEqual(expect.arrayContaining(['Partial recording', 'Track gaps']));
  expect(chips()).not.toContain('Good track');
  const explanation = text();
  expect(explanation).toMatch(/partial|interrupted|incomplete/i);
  expect(explanation).toMatch(/approximate|distance|gaps/i);
  expect(explanation).not.toMatch(/\d+ (seconds|minutes) missing|stopped early/i);
  expect(card().props.accessibilityLabel).toContain('Partial recording');
});

it('does not present no-track distance as a measured zero or promise airtime', async () => {
  await renderFlight(flight({ metrics: metrics({ quality: 'no_track', fixCount: 0, trackDistanceMetres: 0 }) }), []);
  expect(chips()).toContain('No usable track');
  expect(text()).toContain('1:00');
  expect(text()).toContain('—');
  expect(text()).toContain('— Track distance');
  expect(text()).not.toMatch(/airtime/i);
  expect(rendered.root.findByType(FlightMapPreview).props.state).toBe('no_track');
});

it('keeps processing actionable while withholding unfinished metrics instead of falling back to elapsed timestamps', async () => {
  await renderFlight(flight({ status: 'processing', metrics: null }));
  expect(chips()).toEqual(['Finishing stats']);
  expect(text()).not.toMatch(/3:12|Recorded time|Track distance/);
  expect(rendered.root.findByType(FlightMapPreview).props.state).toBe('processing');
  expect(card().props.onPress).toBe(onPress);
});

it('separates restored summary metrics from an IGC route waiting to download', async () => {
  await renderFlight(archived(), []);
  expect(chips()).toEqual(['Restored', 'Good track']);
  expect(text()).toContain('1:00');
  expect(text()).toContain('waiting to download');
  expect(chips()).not.toContain('No usable track');
  expect(rendered.root.findAllByType(FlightMapPreview)).toHaveLength(0);
});

it('keeps missing restored metrics unknown even when start and stop timestamps exist', async () => {
  await renderFlight(archived({ metrics: null, archive: { trackState: 'missing', error: null, downloadedAt: null } }), []);
  expect(chips()).toEqual(['Restored', 'Metrics unavailable']);
  expect(text()).not.toMatch(/3:12|1:00|Finishing stats/);
  expect(text()).toContain('—');
  expect(text()).toContain('no archived route was backed up');
});

const summary: JournalSummary = { flightCount: 4, recordedTimeMs: 7_200_000, longestMs: 5_400_000,
  longestDistanceMetres: 12_600, timeCount: 3, distanceCount: 2 };
it('renders the supplied filtered totals and discloses both incomplete metric coverages and start-to-stop meaning', async () => {
  await act(async () => { rendered = create(React.createElement(JournalSummaryCard, { summary, scopeLabel: 'Filtered flights' })); });
  expect(text()).toContain('FILTERED FLIGHTS');
  expect(text()).toContain('2:00');
  expect(text()).toContain('1:30');
  expect(text()).toContain('Longest recording');
  expect(text()).toContain('Longest track');
  expect(text()).toContain('Recorded time available for 3 of 4 flights; track distance for 2 of 4.');
  expect(text()).toContain('includes time on the ground');
  expect(text()).not.toMatch(/season|airtime|best distance/i);
  expect(rendered.root.findByType(JournalArt).props.scene).toBe('flight');
});

it.each([false, true])('distinguishes absent measurements from measured zero in the summary (zero=%s)', async measuredZero => {
  const value = measuredZero ? 0 : null;
  await act(async () => { rendered = create(React.createElement(JournalSummaryCard, { scopeLabel: 'All history',
    summary: { flightCount: 1, recordedTimeMs: value, longestMs: value, longestDistanceMetres: value,
      timeCount: measuredZero ? 1 : 0, distanceCount: measuredZero ? 1 : 0 } })); });
  if (measuredZero) {
    expect(text()).toContain('0:00');
    expect(text()).not.toContain('—');
    expect(text()).not.toContain('available for');
  } else {
    expect(text()).toContain('—');
    expect(text()).not.toContain('0:00');
    expect(text()).toContain('Recorded time available for 0 of 1 flights; track distance for 0 of 1.');
  }
});
