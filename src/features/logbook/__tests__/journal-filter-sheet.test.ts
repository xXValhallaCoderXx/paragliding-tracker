import React from 'react';
import { Keyboard } from 'react-native';

import { Button, Input } from '@/components/ui';
import type { FlightSummary } from '@/recorder/types';
import { JournalFilterSheet } from '../components/journal-filter-sheet';
import { defaultJournalCriteria, JOURNAL_SORT_OPTIONS, selectJournal, type JournalCriteria } from '../journal-query';
import { flight, metrics } from '../../../../tests/support/fixtures';
import { act, create } from '../../../../tests/support/renderer';

jest.mock('@/lib/use-reduced-motion', () => ({ useReducedMotion: () => false }));
jest.mock('@/components/ui', () => Object.fromEntries([
  'Button', 'Input', 'Screen',
].map((name) => [name, ({ children }: { children?: React.ReactNode }) => children ?? null])));

type TestNode = { props: Record<string, any> };
let rendered: ReturnType<typeof create>;
let flights: FlightSummary[];
let criteria: JournalCriteria;
let apply: jest.Mock;
let close: jest.Mock;
const button = (label: string) => rendered.root.findAllByType(Button).find((node: TestNode) => node.props.label === label);
const input = (label: string) => rendered.root.findAllByType(Input).find((node: TestNode) => node.props.label === label)!;
const option = (group: string, label: string) => rendered.root.findAllByProps({ accessibilityLabel: `${group}: ${label}` })[0];
const facets = () => selectJournal(flights, defaultJournalCriteria()).facets;
async function actOn(action: () => void) { await act(async () => action()); }
const element = () => React.createElement(JournalFilterSheet, { flights, criteria, onApply: apply, onClose: close });
async function mount() { await act(async () => { rendered = create(element()); }); }

beforeEach(() => {
  apply = jest.fn(); close = jest.fn(); criteria = defaultJournalCriteria();
  const sites = ['Alpha Hill', 'Bravo Ridge', 'Charlie Launch', 'Delta Dune', 'Echo Cliff'];
  flights = sites.map((site, index) => flight({ id: `flight-${index}`, site, siteSource: 'manual',
    startedAt: Date.UTC(index === 1 ? 2025 : 2026, 6, 1 + index, 12),
    metrics: metrics({ quality: index === 1 ? 'gaps' : 'healthy' }),
    equipmentSnapshot: { version: 1, capturedAt: 1000, aircraftId: `wing-${index}`,
      sport: index === 1 ? 'hang_gliding' : index === 3 ? 'speedflying' : 'paragliding',
      model: `${site.split(' ')[0]} Wing`, size: null, registrationId: null },
  }));
  jest.spyOn(Keyboard, 'isVisible').mockReturnValue(false);
  jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined);
});
afterEach(async () => {
  if (rendered) await act(async () => rendered.unmount());
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('keeps multi-select groups as a local draft, previews the real result count and applies zero matches explicitly', async () => {
  const { sites, qualities } = facets();
  const alpha = sites.find((item) => item.label === 'Alpha Hill')!;
  const bravo = sites.find((item) => item.label === 'Bravo Ridge')!;
  const gaps = qualities.find((item) => item.value === 'gaps')!;
  await mount();
  expect(button('Show 5 flights')).toBeDefined();
  await actOn(() => option('Site', alpha.label).props.onPress());
  expect(button('Show 1 flight')).toBeDefined();
  await actOn(() => option('Site', bravo.label).props.onPress());
  expect(option('Site', alpha.label).props.accessibilityState.checked).toBe(true);
  expect(option('Site', bravo.label).props.accessibilityState.checked).toBe(true);
  expect(button('Show 2 flights')).toBeDefined();
  await actOn(() => option('Track quality', gaps.label).props.onPress());
  expect(button('Show 1 flight')).toBeDefined();
  await actOn(() => option('Year', '2026').props.onPress());
  expect(button('Show 0 flights')).toBeDefined();
  expect(button('Show 0 flights')!.props.disabled).not.toBe(true);
  const duration = JOURNAL_SORT_OPTIONS.find((item) => item.value === 'duration')!;
  await actOn(() => option('Sort', duration.label).props.onPress());
  expect(apply).not.toHaveBeenCalled();
  expect(criteria).toEqual(defaultJournalCriteria());
  await actOn(() => {
    const submit = button('Show 0 flights')!.props.onPress; submit(); submit();
  });
  expect(apply).toHaveBeenCalledTimes(1);
  expect(apply).toHaveBeenCalledWith({ ...defaultJournalCriteria(), sites: [alpha.value, bravo.value],
    qualities: ['gaps'], year: 2026, sort: 'duration' });
});

it('resets only the draft and discards Cancel changes, then reseeds the applied criteria on reopening', async () => {
  const site = facets().sites.find((item) => item.label === 'Alpha Hill')!;
  criteria = { ...criteria, sites: [site.value], year: 2026, sort: 'oldest' };
  const original = structuredClone(criteria);
  await mount();
  expect(button('Show 1 flight')).toBeDefined();
  await actOn(() => button('Reset')!.props.onPress());
  expect(button('Show 5 flights')).toBeDefined();
  expect(option('Site', site.label).props.accessibilityState.checked).toBe(false);
  expect(option('Year', 'All time').props.accessibilityState.checked).toBe(true);
  expect(criteria).toEqual(original);
  expect(apply).not.toHaveBeenCalled();
  await actOn(() => button('Cancel')!.props.onPress());
  expect(close).toHaveBeenCalledTimes(1);
  expect(apply).not.toHaveBeenCalled();
  await act(async () => rendered.unmount());
  await mount();
  expect(option('Site', site.label).props.accessibilityState.checked).toBe(true);
  expect(option('Year', '2026').props.accessibilityState.checked).toBe(true);
  expect(button('Show 1 flight')).toBeDefined();
});

it('expands and searches sites and aircraft without removing hidden selections from the draft', async () => {
  const site = facets().sites.find((item) => item.label === 'Alpha Hill')!;
  const echo = facets().sites.find((item) => item.label === 'Echo Cliff')!;
  const wing = facets().aircraft.find((item) => item.label.includes('Echo Wing'))!;
  await mount();
  await actOn(() => option('Site', site.label).props.onPress());
  expect(option('Site', echo.label)).toBeUndefined();
  await actOn(() => button('Show all sites')!.props.onPress());
  await actOn(() => input('Search sites').props.onChangeText('  eCHO '));
  expect(option('Site', site.label)).toBeUndefined();
  expect(option('Site', echo.label)).toBeDefined();
  expect(button('Show 1 flight')).toBeDefined();
  await actOn(() => option('Site', echo.label).props.onPress());
  expect(button('Show 2 flights')).toBeDefined();
  await actOn(() => button('Show fewer sites')!.props.onPress());
  expect(option('Site', echo.label).props.accessibilityState.checked).toBe(true);
  await actOn(() => button('Show all aircraft')!.props.onPress());
  await actOn(() => input('Search aircraft').props.onChangeText('echo'));
  await actOn(() => option('Aircraft', wing.label).props.onPress());
  expect(button('Show 1 flight')).toBeDefined();
  await actOn(() => button('Show 1 flight')!.props.onPress());
  expect(apply).toHaveBeenCalledWith({ ...defaultJournalCriteria(), sites: [site.value, echo.value], aircraft: [wing.value] });
});

it('uses single selection for year and sort and permits deselecting a multi-select option', async () => {
  const sport = facets().sports[0]!;
  await mount();
  await actOn(() => option('Sport', sport.label).props.onPress());
  await actOn(() => option('Sport', sport.label).props.onPress());
  expect(option('Sport', sport.label).props.accessibilityState.checked).toBe(false);
  await actOn(() => option('Year', '2025').props.onPress());
  await actOn(() => option('Year', '2026').props.onPress());
  expect(option('Year', '2025').props.accessibilityState.checked).toBe(false);
  expect(option('Year', '2026').props.accessibilityState.checked).toBe(true);
  await actOn(() => option('Year', 'All time').props.onPress());
  const distance = JOURNAL_SORT_OPTIONS.find((item) => item.value === 'distance')!;
  const oldest = JOURNAL_SORT_OPTIONS.find((item) => item.value === 'oldest')!;
  await actOn(() => option('Sort', distance.label).props.onPress());
  await actOn(() => option('Sort', oldest.label).props.onPress());
  expect(option('Sort', distance.label).props.accessibilityState.checked).toBe(false);
  await actOn(() => button('Show 5 flights')!.props.onPress());
  expect(apply).toHaveBeenCalledWith({ ...defaultJournalCriteria(), sort: 'oldest' });
});

it('dismisses the keyboard on the first Android Back, then closes without applying', async () => {
  await mount();
  const modal = rendered.root.findAll((node: TestNode) => node.props.visible === true
    && typeof node.props.onRequestClose === 'function')[0];
  jest.mocked(Keyboard.isVisible).mockReturnValueOnce(true);
  await actOn(() => modal.props.onRequestClose());
  expect(Keyboard.dismiss).toHaveBeenCalledTimes(1);
  expect(close).not.toHaveBeenCalled();
  await actOn(() => modal.props.onRequestClose());
  expect(close).toHaveBeenCalledTimes(1);
  expect(apply).not.toHaveBeenCalled();
});

it('updates preview counts when flights change without silently dropping a selected filter', async () => {
  const site = facets().sites.find((item) => item.label === 'Alpha Hill')!;
  await mount();
  await actOn(() => option('Site', site.label).props.onPress());
  flights = flights.filter((item) => item.site !== 'Alpha Hill');
  await act(async () => rendered.update(element()));
  expect(button('Show 0 flights')).toBeDefined();
  await actOn(() => button('Show 0 flights')!.props.onPress());
  expect(apply).toHaveBeenCalledWith({ ...defaultJournalCriteria(), sites: [site.value] });
});

it('offers the current calendar year even when no saved flights exist for it', async () => {
  jest.useFakeTimers({ now: new Date(2032, 5, 1, 12) });
  flights = [];
  await mount();
  expect(option('Year', '2032')).toBeDefined();
  await actOn(() => option('Year', '2032').props.onPress());
  await actOn(() => button('Show 0 flights')!.props.onPress());
  expect(apply).toHaveBeenCalledWith({ ...defaultJournalCriteria(), year: 2032 });
});

it('bounds large site and aircraft lists to fifty choices per page while retaining selections and resetting search pages', async () => {
  flights = Array.from({ length: 240 }, (_, index) => {
    const suffix = String(index).padStart(3, '0');
    return flight({ id: `flight-${suffix}`, site: `Site ${suffix}`, equipmentSnapshot: {
      version: 1, capturedAt: 1000, aircraftId: `wing-${suffix}`, sport: 'paragliding',
      model: `Wing ${suffix}`, size: null, registrationId: null,
    } });
  });
  const visibleLabels = (group: string) => new Set(rendered.root.findAll((node: TestNode) =>
    node.props.accessibilityRole === 'checkbox' && node.props.accessibilityLabel?.startsWith(`${group}: `))
    .map((node: TestNode) => node.props.accessibilityLabel));
  await mount();
  await actOn(() => button('Show all sites')!.props.onPress());
  expect(visibleLabels('Site').size).toBe(50);
  expect(rendered.root.findAllByProps({ children: 'Showing 1–50 of 240 sites' }).length).toBeGreaterThan(0);
  expect(button('Previous sites')!.props.disabled).toBe(true);
  await actOn(() => option('Site', 'Site 000').props.onPress());
  await actOn(() => button('Next sites')!.props.onPress());
  expect(visibleLabels('Site').size).toBe(50);
  expect(option('Site', 'Site 000')).toBeUndefined();
  await actOn(() => option('Site', 'Site 051').props.onPress());
  await actOn(() => input('Search sites').props.onChangeText('Site 239'));
  expect(visibleLabels('Site').size).toBe(1);
  expect(option('Site', 'Site 239')).toBeDefined();
  expect(rendered.root.findAllByProps({ children: 'Showing 1–1 of 1 sites' }).length).toBeGreaterThan(0);
  await actOn(() => input('Search sites').props.onChangeText(''));
  expect(option('Site', 'Site 000').props.accessibilityState.checked).toBe(true);
  expect(button('Previous sites')!.props.disabled).toBe(true);
  await actOn(() => button('Next sites')!.props.onPress());
  expect(option('Site', 'Site 051').props.accessibilityState.checked).toBe(true);
  await actOn(() => button('Show all aircraft')!.props.onPress());
  expect(visibleLabels('Aircraft').size).toBe(50);
  await actOn(() => button('Next aircraft')!.props.onPress());
  expect(visibleLabels('Aircraft').size).toBe(50);
  await actOn(() => input('Search aircraft').props.onChangeText('Wing 051'));
  expect(visibleLabels('Aircraft').size).toBe(1);
  await actOn(() => option('Aircraft', 'Wing 051').props.onPress());
  await actOn(() => button('Show 1 flight')!.props.onPress());
  expect(apply).toHaveBeenCalledWith({ ...defaultJournalCriteria(),
    sites: ['site:site 000', 'site:site 051'], aircraft: ['wing-051'] });
});
