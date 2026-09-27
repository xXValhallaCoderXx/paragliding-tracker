import React from 'react';
import { Keyboard, Modal } from 'react-native';
import { Button, Input, Notice } from '@/components/ui';
import { SitePickerSheet } from '../components/site-picker-sheet';
import { MetadataForm } from '../components/metadata-form';
import { fetchNearbySites, searchSitesByName } from '@/sites/site-service';
import { readCoarsePosition } from '../current-position';
import type { SiteSuggestion } from '@/sites/types';
import { create, act } from '../../../../tests/support/renderer';

jest.mock('@/components/ui', () => Object.fromEntries(['Button', 'Input', 'Notice', 'Screen', 'SectionLabel', 'Card'].map(name => [name, ({ children }: { children?: React.ReactNode }) => children ?? null])));
jest.mock('@/lib/use-reduced-motion', () => ({ useReducedMotion: () => true }));
jest.mock('@/sites/site-service', () => ({ fetchNearbySites: jest.fn(), searchSitesByName: jest.fn() }));
jest.mock('../current-position', () => ({ readCoarsePosition: jest.fn() }));
const nearby = jest.mocked(fetchNearbySites), search = jest.mocked(searchSitesByName), locate = jest.mocked(readCoarsePosition);
const near = { latitude: 46, longitude: 8 };
const result: SiteSuggestion = { id: 'hill', name: 'Catalogue hill', provider: 'paraglidingearth', distanceMetres: 100, detail: '100 m from recording start', ...near };
const close = jest.fn(), select = jest.fn();
let rendered: ReturnType<typeof create>;
type Node = { props: Record<string, any> };
const buttons = () => (rendered.root.findAllByType(Button) as Node[]).map(node => node.props);
const button = (label: string) => buttons().find(props => props.label === label)!;
const input = () => rendered.root.findByType(Input).props;
async function mount(position: typeof near | null = near) {
  await act(async () => { rendered = create(React.createElement(SitePickerSheet, { site: 'Original site', source: 'osm', near: position, onSelect: select, onClose: close })); });
  await act(async () => jest.advanceTimersByTime(400));
}
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks(); nearby.mockResolvedValue([]); search.mockResolvedValue([]); locate.mockResolvedValue(null);
  jest.spyOn(Keyboard, 'isVisible').mockReturnValue(false);
});
afterEach(async () => { await act(async () => rendered.unmount()); jest.useRealTimers(); jest.restoreAllMocks(); });

it('uses recording coordinates for nearby lookup and does not offer current location', async () => {
  nearby.mockResolvedValue([result]); await mount();
  expect(nearby).toHaveBeenCalledWith(near, expect.objectContaining({ signal: expect.anything() }));
  expect(buttons().some(props => props.label === 'Use my current location')).toBe(false);
  await act(async () => button('Catalogue hill').onPress()); expect(select).toHaveBeenCalledWith('Catalogue hill', 'paraglidingearth');
});
it('keeps manual naming available offline, retries failed lookup, and clears explicitly', async () => {
  nearby.mockRejectedValue({ kind: 'offline' }); await mount();
  expect(rendered.root.findByType(Notice).props.children).toContain('offline');
  nearby.mockResolvedValue([]); await act(async () => button('Retry site lookup').onPress()); await act(async () => jest.advanceTimersByTime(400));
  expect(nearby).toHaveBeenCalledTimes(2);
  await act(async () => input().onChangeText('  My meadow  '));
  await act(async () => button('Use this site name').onPress()); expect(select).toHaveBeenCalledWith('My meadow', 'manual');
  await act(async () => rendered.unmount()); await mount(); await act(async () => button('Clear site').onPress());
  expect(select).toHaveBeenLastCalledWith('', null);
});
it('debounces search, aborts superseded requests, and ignores their late results', async () => {
  let resolve!: (value: SiteSuggestion[]) => void; search.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  await mount(); await act(async () => input().onChangeText('First place')); await act(async () => jest.advanceTimersByTime(400));
  const signal = search.mock.calls[0]![1]!.signal!;
  await act(async () => input().onChangeText('Second place')); expect(signal.aborted).toBe(true);
  await act(async () => resolve([result])); await act(async () => jest.advanceTimersByTime(400));
  expect(buttons().some(props => props.label === result.name)).toBe(false);
});
it('cancel aborts lookup/location and ignores obsolete selection callbacks', async () => {
  let finish!: (value: typeof near) => void; locate.mockReturnValue(new Promise(done => { finish = done; }));
  await mount(null);
  const staleManual = button('Use this site name').onPress;
  await act(async () => button('Use my current location').onPress());
  const signal = locate.mock.calls[0]![1]!;
  await act(async () => button('Cancel site selection').onPress()); expect(signal.aborted).toBe(true);
  await act(async () => { finish(near); staleManual(); }); expect(select).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(1);
});
it('Android Back dismisses the keyboard before cancelling the nested sheet', async () => {
  await mount(); jest.mocked(Keyboard.isVisible).mockReturnValue(true); const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined);
  rendered.root.findByType(Modal).props.onRequestClose(); expect(dismiss).toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
  jest.mocked(Keyboard.isVisible).mockReturnValue(false); rendered.root.findByType(Modal).props.onRequestClose(); expect(close).toHaveBeenCalledTimes(1);
});
it('site Cancel retains the parent draft; selection updates only the parent draft', async () => {
  const change = jest.fn(), save = jest.fn(); const values = { title: 'Draft title', notes: 'Private draft', site: 'Existing site', siteSource: 'osm' as const };
  await act(async () => { rendered = create(React.createElement(MetadataForm, { values, onChange: change, dirty: true, saving: false, onSave: save, takeoff: near })); });
  await act(async () => button('Existing site').onPress());
  await act(async () => button('Cancel site selection').onPress()); expect(change).not.toHaveBeenCalled();
  await act(async () => button('Existing site').onPress());
  const sheet = rendered.root.findByType(SitePickerSheet);
  await act(async () => sheet.props.onSelect('New site', 'paraglidingearth'));
  expect(change).toHaveBeenCalledWith({ ...values, site: 'New site', siteSource: 'paraglidingearth' }); expect(save).not.toHaveBeenCalled();
});
