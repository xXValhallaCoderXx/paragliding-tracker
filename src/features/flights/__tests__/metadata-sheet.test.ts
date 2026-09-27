import React from 'react';
import { Alert, Keyboard, Modal } from 'react-native';
import { Button, Notice } from '@/components/ui';
import { FlightMetadataConflict } from '@/lib/flight-mutations';
import { setFlightAuthIdentity } from '@/lib/flight-scope';
import type { FlightDetail } from '@/recorder/types';
import { MetadataForm } from '../components/metadata-form';
import { MetadataSheet } from '../components/metadata-sheet';
import { flightPatch, hasFlightEdits } from '../metadata-editor';

import { create, act } from '../../../../tests/support/renderer';
type Rendered = { root: { findByType: (type: unknown) => { props: { onRequestClose: () => void } } }; update: (element: React.ReactElement) => void; unmount: () => void };
jest.mock('@/components/ui', () => ({
  SectionLabel: () => null, Button: jest.fn(() => null), Notice: jest.fn(() => null),
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
  onSave.mockImplementation(async (request) => ({ ...flight, ...request.patch }));
  jest.spyOn(Keyboard, 'isVisible').mockReturnValue(false);
  setFlightAuthIdentity(null);
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
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ patch: { title: 'New title' }, original: expect.objectContaining({ title: 'Old title', notes: null, site: 'Launch' }) }));
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
  let finish!: (value: FlightDetail) => void;
  onSave.mockReturnValue(new Promise<FlightDetail>((resolve) => { finish = resolve; }));
  await edit();
  await act(async () => { form().onSave(); form().onSave(); });
  expect(onSave).toHaveBeenCalledTimes(1);
  rendered.root.findByType(Modal).props.onRequestClose();
  expect(onClose).not.toHaveBeenCalled();
  expect(form().disabled).toBe(true);
  await act(async () => finish({ ...flight, title: 'New title' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});
it('clears stale attribution with an empty site and marks manual text correctly', () => {
  expect(flightPatch({ ...form().values, site: ' ', siteSource: 'osm' }, form().values)).toEqual({ site: null, siteSource: null });
  expect(flightPatch({ ...form().values, site: 'My meadow', siteSource: null }, form().values)).toEqual({ site: 'My meadow', siteSource: 'manual' });
  expect(flightPatch({ ...form().values, siteSource: 'osm' }, form().values)).toEqual({ site: 'Launch', siteSource: 'osm' });
  expect(hasFlightEdits({ ...form().values, siteSource: 'osm' }, form().values)).toBe(true);
});

it('dismisses the keyboard before protecting dirty drafts on Android Back', async () => {
  await edit(); jest.mocked(Keyboard.isVisible).mockReturnValue(true);
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined);
  rendered.root.findByType(Modal).props.onRequestClose();
  expect(dismiss).toHaveBeenCalled(); expect(Alert.alert).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
});
it('shows saved versus draft conflicts, explicitly rebases edited fields, and needs another Save', async () => {
  await edit();
  const saved = { title: 'Other device title', site: 'Newer site', siteSource: 'osm' as const, notes: 'Newer note' };
  onSave.mockRejectedValueOnce(new FlightMetadataConflict(saved, ['title']));
  await act(async () => form().onSave());
  expect(form().values.title).toBe('New title'); expect(onClose).not.toHaveBeenCalled();
  await act(async () => jest.mocked(Button).mock.calls.findLast(([props]) => props.label === 'Keep my edits')![0].onPress());
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(form().values).toEqual({ title: 'New title', site: 'Newer site', siteSource: 'osm', notes: 'Newer note' });
  await act(async () => form().onSave());
  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ original: saved, patch: { title: 'New title' } }));
});
it('Use saved details reloads all metadata without writing', async () => {
  await edit(); const saved = { title: 'Other title', site: null, siteSource: null, notes: 'Other notes' };
  onSave.mockRejectedValueOnce(new FlightMetadataConflict(saved, ['title']));
  await act(async () => form().onSave());
  await act(async () => jest.mocked(Button).mock.calls.findLast(([props]) => props.label === 'Use saved details')![0].onPress());
  expect(form().values).toEqual({ title: 'Other title', site: '', siteSource: null, notes: 'Other notes' });
  expect(form().dirty).toBe(false); expect(onSave).toHaveBeenCalledTimes(1);
});
it('rejects old save and discard callbacks after an account changes away and back', async () => {
  await edit(); const save = form().onSave;
  rendered.root.findByType(Modal).props.onRequestClose();
  const discard = jest.mocked(Alert.alert).mock.calls.at(-1)![2]!.find(button => button.text === 'Discard')!.onPress!;
  setFlightAuthIdentity('other'); setFlightAuthIdentity(null);
  await act(async () => { save(); discard(); });
  expect(onSave).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
});
it('ignores completion after the editor was unmounted', async () => {
  await edit(); let finish!: (value: FlightDetail) => void;
  onSave.mockReturnValue(new Promise<FlightDetail>(resolve => { finish = resolve; }));
  await act(async () => { form().onSave(); });
  await act(async () => rendered.unmount());
  await act(async () => finish({ ...flight, title: 'New title' }));
  expect(onClose).not.toHaveBeenCalled();
});
