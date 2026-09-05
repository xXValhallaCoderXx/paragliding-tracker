import React from 'react';
import { Alert, AppState, Modal, Platform, Switch, TextInput, type AppStateStatus } from 'react-native';
import { Button, Notice } from '@/components/ui';
import { useGetFlightQuery, useGetFlightTrackQuery, useGetProfileQuery } from '@/store/endpoints';
import type { FlightDetail } from '@/recorder/types';
import { loadPostcardFonts } from '../assets';
import { postcardExportAdapter } from '../export-adapter';
import { PostcardCard } from '../postcard-card';
import { PostcardComposer, PostcardEditor } from '../postcard-composer';
import type { PostcardExportAdapter } from '../export';
import type { PostcardSource } from '../presentation';

import { create, act } from '../../../../tests/support/renderer';
type Node = { props: { accessibilityLabel?: string; onPress: () => void; onRequestClose: () => void; onChangeText: (text: string) => void; onValueChange: (value: boolean) => void; editable: boolean } };
type Rendered = { root: { findByType: (type: unknown) => Node; findAll: (predicate: (node: Node) => boolean) => Node[] }; unmount: () => void; update: (element: React.ReactElement) => void };
jest.mock('@/components/ui', () => ({
  Button: jest.fn(() => null), Notice: jest.fn(() => null), BusyRow: () => null,
  Screen: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/store/endpoints', () => ({ useGetFlightQuery: jest.fn(), useGetFlightTrackQuery: jest.fn(), useGetProfileQuery: jest.fn() }));
jest.mock('@/lib/use-reduced-motion', () => ({ useReducedMotion: () => true }));
jest.mock('../assets', () => ({ loadPostcardFonts: jest.fn(), POSTCARD_ART: { flying: 1, launch: 2, landing: 3 } }));
jest.mock('../postcard-card', () => ({ PostcardCard: jest.fn(() => null) }));
jest.mock('../export-adapter', () => ({ postcardExportAdapter: jest.fn(), cleanupPostcards: jest.fn().mockResolvedValue(undefined) }));
const source: PostcardSource = { title: 'Ridge', site: null, date: 'Sat 5 Sep 2026', airtime: '1h', distance: '12 km', altitude: '1234 m', labels: [], attribution: null, pilotName: 'Sam', segments: [[46, 8, 47, 9]] };
let rendered: Rendered;
let port: jest.Mocked<PostcardExportAdapter>;
let listeners: Record<string, (state: AppStateStatus) => void>;
const onClose = jest.fn();
const card = () => jest.mocked(PostcardCard).mock.calls.at(-1)![0];
const button = (label: string) => [...jest.mocked(Button).mock.calls].reverse().find(([props]) => props.label === label)![0];
const choose = (label: string) => rendered.root.findAll((node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0].props.onPress();
async function mount() { await act(async () => { rendered = create(React.createElement(PostcardEditor, { source, onClose })); }); }
async function ready() {
  await act(async () => { card().onLayout(); card().onImageLoad(); });
  await act(async () => { jest.advanceTimersByTime(100); });
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => {
  jest.clearAllMocks(); jest.useFakeTimers(); listeners = {};
  jest.replaceProperty(Platform, 'OS', 'android');
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active', writable: true });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((event, callback) => {
    listeners[event] = callback; return { remove: jest.fn() };
  });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.mocked(loadPostcardFonts).mockResolvedValue(undefined);
  port = { cleanup: jest.fn().mockResolvedValue(undefined), available: jest.fn().mockResolvedValue(true),
    capture: jest.fn().mockResolvedValue('/tmp/image.png'), validate: jest.fn().mockResolvedValue(undefined),
    copy: jest.fn().mockResolvedValue('file:///cache/image.png'), release: jest.fn(),
    remove: jest.fn().mockResolvedValue(undefined), share: jest.fn().mockResolvedValue(undefined) };
  jest.mocked(postcardExportAdapter).mockReturnValue(port);
});
afterEach(async () => { if (rendered) await act(async () => rendered.unmount()); jest.useRealTimers(); jest.restoreAllMocks(); });

it('waits for fonts, illustration, layout and the committed composition', async () => {
  const fonts = deferred<void>(); jest.mocked(loadPostcardFonts).mockReturnValue(fonts.promise);
  await mount();
  expect(button('Share image').disabled).toBe(true);
  await act(async () => card().onLayout());
  expect(button('Share image').disabled).toBe(true);
  await act(async () => card().onImageLoad());
  await act(async () => fonts.resolve());
  expect(button('Share image').disabled).toBe(true);
  await act(async () => jest.advanceTimersByTime(100));
  expect(button('Share image').disabled).toBe(false);
});
it('requires the new image and layout after switching format or scene', async () => {
  await mount(); await ready();
  await act(async () => choose('Story'));
  expect(button('Share image').disabled).toBe(true);
  await act(async () => card().onImageLoad());
  await act(async () => jest.advanceTimersByTime(100));
  expect(button('Share image').disabled).toBe(true);
  await act(async () => card().onLayout());
  expect(button('Share image').disabled).toBe(true);
  await act(async () => jest.advanceTimersByTime(100));
  expect(card().draft.format).toBe('story');
  expect(button('Share image').disabled).toBe(false);
  await act(async () => choose('Landing'));
  expect(button('Share image').disabled).toBe(true);
  await act(async () => card().onLayout());
  await act(async () => jest.advanceTimersByTime(100));
  expect(button('Share image').disabled).toBe(true);
  await act(async () => card().onImageLoad());
  await act(async () => jest.advanceTimersByTime(100));
  expect(button('Share image').disabled).toBe(false);
});
it('ignores late image failures and loads from an earlier scene', async () => {
  await mount(); await ready(); const previous = card();
  await act(async () => choose('Landing')); await ready();
  await act(async () => { previous.onImageError(); previous.onImageLoad(); });
  expect(button('Share image').disabled).toBe(false);
  expect(card().draft.scene).toBe('landing');
});
it('locks edits and duplicate submissions and preserves the draft after share dismissal', async () => {
  await mount();
  await act(async () => rendered.root.findByType(TextInput).props.onChangeText('Lovely sky 🪂'));
  await ready();
  const capture = deferred<string>(); port.capture.mockReturnValue(capture.promise);
  await act(async () => { button('Share image').onPress(); button('Share image').onPress(); });
  expect(port.capture).toHaveBeenCalledTimes(1);
  expect(rendered.root.findByType(TextInput).props.editable).toBe(false);
  await act(async () => { choose('Story'); rendered.root.findByType(TextInput).props.onChangeText('blocked'); });
  expect(card().draft.caption).toBe('Lovely sky 🪂'); expect(card().draft.format).toBe('square');
  await act(async () => capture.resolve('/tmp/image.png'));
  expect(onClose).not.toHaveBeenCalled(); expect(card().draft.caption).toBe('Lovely sky 🪂');
  expect(button('Share image').disabled).toBe(false);
});
it('blocks a stale share callback in the same turn as a caption edit', async () => {
  await mount(); await ready(); const share = button('Share image').onPress;
  await act(async () => { rendered.root.findByType(TextInput).props.onChangeText('New caption'); share(); });
  expect(port.capture).not.toHaveBeenCalled();
});
it.each(['change', 'blur'])('abandons preparation on AppState %s and never shares automatically on return', async (event) => {
  await mount(); await ready(); const capture = deferred<string>(); port.capture.mockReturnValue(capture.promise);
  await act(async () => button('Share image').onPress());
  await act(async () => { listeners[event]('background'); listeners.change('active'); listeners.focus?.('active'); });
  await act(async () => capture.resolve('/tmp/image.png'));
  expect(port.share).not.toHaveBeenCalled(); expect(port.release).toHaveBeenCalled();
  expect(button('Share image').disabled).toBe(false);
});
it('abandons preparation when closed and releases the capture', async () => {
  await mount(); await ready(); const capture = deferred<string>(); port.capture.mockReturnValue(capture.promise);
  await act(async () => button('Share image').onPress());
  await act(async () => button('Cancel').onPress());
  await act(async () => capture.resolve('/tmp/image.png'));
  expect(onClose).toHaveBeenCalledTimes(1); expect(port.share).not.toHaveBeenCalled();
  expect(port.release).toHaveBeenCalledWith('/tmp/image.png');
});
it('requires confirmation for a caption, including whitespace, and never saves it to a flight', async () => {
  await mount(); await act(async () => rendered.root.findByType(TextInput).props.onChangeText(' '));
  button('Cancel').onPress(); expect(onClose).not.toHaveBeenCalled();
  jest.mocked(Alert.alert).mock.calls.at(-1)![2]!.find((entry) => entry.text === 'Discard')!.onPress!();
  expect(onClose).toHaveBeenCalledTimes(1); expect(card().source).not.toHaveProperty('notes');
});
it('supports signature opt-out and limits long captions', async () => {
  await mount(); await act(async () => {
    rendered.root.findByType(Switch).props.onValueChange(false);
    rendered.root.findByType(TextInput).props.onChangeText('🪂'.repeat(150));
  });
  expect(card().draft.signature).toBe(false); expect(Array.from(card().draft.caption)).toHaveLength(140);
});
it.each(['fonts', 'illustration'])('shows an in-composer %s failure with retry', async (asset) => {
  if (asset === 'fonts') jest.mocked(loadPostcardFonts).mockRejectedValueOnce(new Error('missing'));
  await mount();
  if (asset === 'illustration') await act(async () => card().onImageError());
  expect(button('Share image').disabled).toBe(true);
  expect(jest.mocked(Notice).mock.calls.at(-1)![0].title).toBe('Could not prepare preview');
  await act(async () => button('Retry preview').onPress()); await ready();
  expect(button('Share image').disabled).toBe(false);
});
it('keeps capture failures local and retries without closing', async () => {
  await mount(); await ready(); port.capture.mockRejectedValueOnce(new Error('capture failed'));
  await act(async () => button('Share image').onPress());
  expect(button('Retry sharing').disabled).toBe(false); expect(onClose).not.toHaveBeenCalled();
  await act(async () => button('Retry sharing').onPress()); expect(port.share).toHaveBeenCalledTimes(1);
});

const flight = { status: 'completed', sessionStatus: 'completed', title: 'Opening title', startedAt: 0, endedAt: 3600, timezoneOffsetMinutes: 0, metrics: { durationMs: 3600, quality: 'healthy', fixCount: 2, trackDistanceMetres: 10, maxGpsAltitude: 20 } } as FlightDetail;
function queries(error?: unknown) {
  jest.mocked(useGetFlightQuery).mockReturnValue({ currentData: flight, error, refetch: jest.fn() } as unknown as ReturnType<typeof useGetFlightQuery>);
  jest.mocked(useGetFlightTrackQuery).mockReturnValue({ currentData: [], refetch: jest.fn() } as unknown as ReturnType<typeof useGetFlightTrackQuery>);
  jest.mocked(useGetProfileQuery).mockReturnValue({ error: { message: 'profile unavailable' } } as unknown as ReturnType<typeof useGetProfileQuery>);
}
it('freezes data, omits failed optional profile, and protects Android Back in the same modal', async () => {
  queries(); await act(async () => { rendered = create(React.createElement(PostcardComposer, { flightId: 'f', onClose })); });
  expect(card().source.title).toBe('Opening title'); expect(card().source.pilotName).toBeNull();
  const reads = jest.mocked(useGetFlightQuery).mock.calls.length;
  jest.mocked(useGetFlightQuery).mockReturnValue({ currentData: { ...flight, title: 'New title' } } as unknown as ReturnType<typeof useGetFlightQuery>);
  await act(async () => rendered.update(React.createElement(PostcardComposer, { flightId: 'f', onClose })));
  expect(card().source.title).toBe('Opening title'); expect(useGetFlightQuery).toHaveBeenCalledTimes(reads);
  await act(async () => rendered.root.findByType(TextInput).props.onChangeText('Keep me'));
  rendered.root.findByType(Modal).props.onRequestClose(); expect(Alert.alert).toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});
it.each(['flight', 'track'])('offers Retry for a %s read failure', async (kind) => {
  queries(kind === 'flight' ? { message: 'read failed' } : undefined);
  if (kind === 'track') jest.mocked(useGetFlightTrackQuery).mockReturnValue({ error: { message: 'track failed' }, refetch: jest.fn() } as unknown as ReturnType<typeof useGetFlightTrackQuery>);
  await act(async () => { rendered = create(React.createElement(PostcardComposer, { flightId: 'f', onClose })); });
  expect(PostcardCard).not.toHaveBeenCalled();
  const flightRefetch = jest.mocked(useGetFlightQuery).mock.results.at(-1)!.value.refetch;
  const trackRefetch = jest.mocked(useGetFlightTrackQuery).mock.results.at(-1)!.value.refetch;
  await act(async () => button('Retry').onPress());
  expect(flightRefetch).toHaveBeenCalledTimes(1);
  expect(trackRefetch).toHaveBeenCalledTimes(1);
});
