import React from 'react';
import { Alert, Modal } from 'react-native';
import { Button, Notice } from '@/components/ui';
import type { FlightDetail } from '@/recorder/types';
import { MetadataForm } from '../components/metadata-form';
import { MetadataSheet } from '../components/metadata-sheet';
import { flightPatch, hasFlightEdits } from '../metadata-editor';

// Use the renderer already installed by jest-expo, without adding a runtime dependency.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- resolve the renderer bundled with jest-expo
const { create, act } = require(require.resolve('react-test-renderer', { paths: [require.resolve('jest-expo/package.json')] }));
type Rendered = { root: { findByType: (type: unknown) => { props: { onRequestClose: () => void } } }; update: (element: React.ReactElement) => void; unmount: () => void };
jest.mock('@/components/ui', () => ({
  Button: jest.fn(() => null), Notice: jest.fn(() => null),
  Screen: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../components/metadata-form', () => ({ MetadataForm: jest.fn(() => null) }));
jest.mock('@/lib/use-reduced-motion', () => ({ useReducedMotion: () => true }));

const flight = { id: 'f', title: 'Old title', site: 'Launch', notes: null, siteSource: 'paraglidingearth', takeoffLatitude: 46, takeoffLongitude: 8 } as FlightDetail;
const form = () => jest.mocked(MetadataForm).mock.calls.at(-1)![0];
let rendered: Rendered;
const onClose = jest.fn();
const onSave = jest.fn();
beforeEach(async () => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  onSave.mockResolvedValue(undefined);
  await act(async () => { rendered = create(React.createElement(MetadataSheet, { flight, onClose, onSave })); });
});
afterEach(async () => { await act(async () => rendered.unmount()); jest.restoreAllMocks(); });
async function edit() { await act(async () => form().onChange({ ...form().values, title: 'New title' })); }

it('seeds site attribution and launch coordinates', () => {
  expect(form().values.siteSource).toBe('paraglidingearth');
  expect(form().takeoff).toEqual({ latitude: 46, longitude: 8 });
});
it('Cancel closes a clean editor without writing', () => {
  const cancel = jest.mocked(Button).mock.calls.find(([props]) => props.label === 'Cancel')![0];
  cancel.onPress(); expect(onClose).toHaveBeenCalledTimes(1); expect(onSave).not.toHaveBeenCalled();
});
it.each(['cancel', 'android-back'])('%s protects a dirty draft until discard is confirmed', async (via) => {
  await edit();
  if (via === 'android-back') rendered.root.findByType(Modal).props.onRequestClose();
  else jest.mocked(Button).mock.calls.at(-1)![0].onPress();
  expect(onClose).not.toHaveBeenCalled();
  expect(Alert.alert).toHaveBeenCalled();
  const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)![2]!;
  buttons.find((button) => button.text === 'Discard')!.onPress!();
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onSave).not.toHaveBeenCalled();
});
it('upstream metadata refresh cannot overwrite an unsaved draft', async () => {
  await edit();
  await act(async () => rendered.update(React.createElement(MetadataSheet, { flight: { ...flight, title: 'Cloud title' }, onClose, onSave })));
  expect(form().values.title).toBe('New title');
});
it('saving a title edit leaves newer notes and site attribution untouched', async () => {
  await edit();
  await act(async () => rendered.update(React.createElement(MetadataSheet, {
    flight: { ...flight, notes: 'New cloud note', site: 'Cloud launch', siteSource: 'osm' }, onClose, onSave,
  })));
  await act(async () => form().onSave());
  expect(onSave).toHaveBeenCalledWith({ title: 'New title' });
  expect(onClose).toHaveBeenCalledTimes(1);
});
it('keeps the editor open with its draft and error when saving fails', async () => {
  await edit(); onSave.mockRejectedValue({ message: 'disk full' });
  await act(async () => form().onSave());
  expect(onClose).not.toHaveBeenCalled();
  expect(form().values.title).toBe('New title');
  expect(jest.mocked(Notice).mock.calls.at(-1)![0].children).toBe('disk full');
  expect(form().saving).toBe(false);
});
it('blocks repeated save/back and closes only after successful save', async () => {
  let finish!: () => void;
  onSave.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
  await edit();
  await act(async () => { form().onSave(); form().onSave(); });
  expect(onSave).toHaveBeenCalledTimes(1);
  rendered.root.findByType(Modal).props.onRequestClose();
  expect(onClose).not.toHaveBeenCalled();
  expect(form().disabled).toBe(true);
  await act(async () => finish());
  expect(onClose).toHaveBeenCalledTimes(1);
});
it('clears stale attribution with an empty site and marks manual text correctly', () => {
  expect(flightPatch({ ...form().values, site: ' ', siteSource: 'osm' }, form().values)).toEqual({ site: null, siteSource: null });
  expect(flightPatch({ ...form().values, site: 'My meadow', siteSource: null }, form().values)).toEqual({ site: 'My meadow', siteSource: 'manual' });
  expect(flightPatch({ ...form().values, siteSource: 'osm' }, form().values)).toEqual({ site: 'Launch', siteSource: 'osm' });
  expect(hasFlightEdits({ ...form().values, siteSource: 'osm' }, form().values)).toBe(true);
});
