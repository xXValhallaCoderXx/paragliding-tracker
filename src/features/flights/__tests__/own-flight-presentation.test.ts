import React from 'react';
import { Text } from 'react-native';
import { Button } from '@/components/ui';
import { flight, metrics } from '../../../../tests/support/fixtures';
import type { ArchivedFlightDetail, FlightDetail } from '@/recorder/types';
import { ownFlightAvailability, ownFlightMetrics, ownFlightInsight, recordingCoordinate } from '../own-flight-presentation';
import { OwnFlightStats } from '../components/own-flight-stats';
import { CapturedAircraft } from '../components/captured-aircraft';
import { create, act } from '../../../../tests/support/renderer';
jest.mock('@/components/ui', () => ({ Button: () => null, SectionLabel: ({ children }: { children: React.ReactNode }) => children }));
const detail = (override = {}) => ({ ...flight(), session: {}, ...override }) as FlightDetail;
const archived = (override = {}) => ({ ...flight(), source: 'archive', session: null, sessionStatus: null, ownerUserId: 'pilot',
  archive: { trackState: 'error', error: 'replacement failed', downloadedAt: 2000 }, ...override }) as ArchivedFlightDetail;
it.each([
  ['complete', detail(), '1:00:00'], ['partial', detail({ status: 'partial', metrics: metrics({ quality: 'partial' }) }), '1:00:00'],
  ['gaps', detail({ metrics: metrics({ quality: 'gaps' }) }), '1:00:00'], ['restored', archived(), '1:00:00'],
  ['missing', archived({ metrics: null }), '—'], ['processing', detail({ status: 'processing', metrics: null }), '—'],
])('uses persisted recorded time for %s', (_name, value, expected) => { expect(ownFlightMetrics(value as FlightDetail).time).toBe(expected); });
it.each([0, 1])('does not invent distance from %i GPS fixes', fixCount => {
  const value = ownFlightMetrics(detail({ metrics: metrics({ fixCount, quality: 'healthy', trackDistanceMetres: 0 }) }));
  expect(value.distanceMetres).toBeNull();
});
it('preserves measured zero and negative GPS altitude without an elapsed-time guess', () => {
  expect(ownFlightMetrics(detail({ metrics: metrics({ trackDistanceMetres: 0, durationMs: 0, maxGpsAltitude: -10, maxGroundSpeed: 0 }) }))).toMatchObject({ distanceMetres: 0, durationMs: 0, maximumAltitude: '−10\u00a0m', maximumSpeed: '0\u00a0km/h' });
  expect(ownFlightMetrics(detail({ metrics: null }))).toMatchObject({ durationMs: null, distanceMetres: null });
});
it('keeps a prior verified archive usable and allows no-metric archive editing', () => {
  expect(ownFlightAvailability(archived())).toMatchObject({ finished: true, igcReason: null, replayReason: null, diagnostics: false });
  expect(ownFlightAvailability(archived({ metrics: null }))).toMatchObject({ editReason: null });
});
it('never reads current location implicitly and rejects invalid stored coordinates', () => {
  expect(recordingCoordinate(flight())).toBeNull(); expect(recordingCoordinate(flight({ takeoffLatitude: 0, takeoffLongitude: 0 }))).toEqual({ latitude: 0, longitude: 0 });
  expect(recordingCoordinate(flight({ takeoffLatitude: 91, takeoffLongitude: 8 }))).toBeNull();
});
it('requires supporting local measurements for personal comparisons', () => {
  const current = flight(); expect(ownFlightInsight(current, [current])).toBeNull();
  expect(ownFlightInsight(current, [current, flight({ id: 'b', metrics: null })])).toBeNull();
  expect(ownFlightInsight(current, [current, flight({ id: 'b', metrics: metrics({ durationMs: 1 }) })])).toContain('recorded time');
});
it('shows only supported stats, Start/Stop and timezone, with unavailable straight line for one fix', async () => {
  let renderer: ReturnType<typeof create>;
  await act(async () => { renderer = create(React.createElement(OwnFlightStats, { flight: detail(), track: [[46, 8]] })); });
  await act(async () => renderer.root.findByType(Button).props.onPress());
  const text = renderer!.root.findAllByType(Text).map((node: { props: { children: unknown } }) => node.props.children).join(' ');
  expect(text).toContain('Start-to-stop straight-line distance —'); expect(text).toContain('Recording timezone UTC+7');
  expect(text).not.toMatch(/Airtime|Best climb|Above launch|Furthest|Launched|Landed/);
  await act(async () => renderer.unmount());
});
it.each([null, { version: 1, capturedAt: 1000, aircraftId: null, model: null, sport: null, size: null, registrationId: null },
  { version: 1, capturedAt: 1000, aircraftId: 'old-aircraft', model: 'Historical wing', sport: 'hang_gliding', size: '155', registrationId: 'HG-OLD' },
])('renders captured aircraft distinctly from unknown and explicit none: %o', async equipmentSnapshot => {
  let renderer: ReturnType<typeof create>;
  await act(async () => { renderer = create(React.createElement(CapturedAircraft, { flight: detail({ equipmentSnapshot }) })); });
  const text = renderer!.root.findAllByType(Text).map((node: { props: { children: unknown } }) => JSON.stringify(node.props.children)).join(' ');
  expect(text).toContain(!equipmentSnapshot ? 'Unknown aircraft' : !equipmentSnapshot.aircraftId ? 'No aircraft selected' : 'Historical wing');
  if (equipmentSnapshot?.aircraftId) { expect(text).toContain('HG-OLD'); expect(text).toContain('155'); expect(text).toContain('Hang gliding'); }
  await act(async () => renderer.unmount());
});
