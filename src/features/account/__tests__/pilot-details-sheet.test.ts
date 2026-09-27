import React from 'react';
import { Alert, Keyboard } from 'react-native';

import { Input, Notice, TopBar } from '@/components/ui';
import { FormSheet } from '@/features/equipment/form-sheet';
import { equipmentExportHeaders } from '@/recorder/equipment-export';
import { buildUnsignedIgc } from '@/recorder/igc';
import type { PilotProfile } from '@/recorder/types';
import { PilotDetailsSheet } from '../components/pilot-details-sheet';
import { profile } from '../../../../tests/support/fixtures';
import { act, create } from '../../../../tests/support/renderer';

jest.mock('@/lib/use-reduced-motion', () => ({ useReducedMotion: () => false }));
jest.mock('@/components/ui', () => Object.fromEntries([
  'Button', 'Card', 'Input', 'Notice', 'SectionLabel', 'Screen', 'TopBar',
].map((name) => [name, ({ children }: { children?: React.ReactNode }) => children ?? null])));

type TestNode = { props: Record<string, any> };
let rendered: ReturnType<typeof create>;
let saved: PilotProfile;
let save: jest.Mock;
let cancel: jest.Mock;
const field = (label: string) => rendered.root.findAllByType(Input)
  .find((node: TestNode) => node.props.label === label)!;
const sheet = () => rendered.root.findByType(FormSheet).props;
async function actOn(action: () => void) { await act(async () => action()); }
async function mount(saving = false) {
  await act(async () => {
    rendered = create(React.createElement(PilotDetailsSheet, {
      profile: saved, saving, onSave: save, onCancel: cancel,
    }));
  });
}
beforeEach(() => {
  saved = profile({ pilotName: 'Saved Pilot', registrationId: 'PRIVATE-REF',
    gliderType: 'Legacy equipment', gliderId: 'LEGACY-ID' });
  save = jest.fn().mockResolvedValue(undefined);
  cancel = jest.fn();
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(Keyboard, 'isVisible').mockReturnValue(false);
});
afterEach(async () => {
  if (rendered) await act(async () => rendered.unmount());
  jest.restoreAllMocks();
});

it('retains a failed draft for retry and saves only the private name and general reference', async () => {
  // RTK Query unwrap can reject a serialized error rather than an Error instance.
  save.mockRejectedValueOnce({ message: 'Local storage is unavailable. Try again.' });
  await mount();
  expect(rendered.root.findAllByType(Input)).toHaveLength(2);
  await actOn(() => field('Pilot name').props.onChangeText('  Draft Pilot  '));
  await actOn(() => field('General pilot reference — optional').props.onChangeText('  NEW-REF  '));
  await actOn(() => sheet().onSave());
  expect(save).toHaveBeenLastCalledWith({ pilotName: 'Draft Pilot', registrationId: 'NEW-REF' });
  expect(cancel).not.toHaveBeenCalled();
  expect(field('Pilot name').props.value).toBe('  Draft Pilot  ');
  expect(field('General pilot reference — optional').props.value).toBe('  NEW-REF  ');
  expect(field('Pilot name').props.editable).toBe(true);
  expect(sheet()).toMatchObject({ dirty: true, busy: false });
  expect(rendered.root.findByType(Notice).props.children).toBe('Local storage is unavailable. Try again.');
  expect(saved.pilotName).toBe('Saved Pilot');
  await actOn(() => sheet().onSave());
  expect(save).toHaveBeenCalledTimes(2);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[1][0]).not.toHaveProperty('gliderType');
  expect(save.mock.calls[1][0]).not.toHaveProperty('gliderId');
});

it('guards immediate duplicate submissions and keeps fields locked until persistence succeeds', async () => {
  let finish!: () => void;
  save.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  await mount();
  await actOn(() => { const submit = sheet().onSave; submit(); submit(); });
  expect(save).toHaveBeenCalledTimes(1);
  expect(cancel).not.toHaveBeenCalled();
  expect(sheet().busy).toBe(true);
  expect(field('Pilot name').props.editable).toBe(false);
  expect(field('General pilot reference — optional').props.editable).toBe(false);
  await actOn(finish);
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('respects a save still running in the owning Pilot screen', async () => {
  await mount(true);
  expect(sheet().busy).toBe(true);
  expect(field('Pilot name').props.editable).toBe(false);
  await actOn(() => sheet().onSave());
  expect(save).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
});

it('uses keyboard-first Back, confirms discard, and starts a fresh draft on reopening', async () => {
  const dismissKeyboard = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined);
  await mount();
  expect(sheet().dirty).toBe(false);
  await actOn(() => field('Pilot name').props.onChangeText('Discard this draft'));
  expect(sheet().dirty).toBe(true);
  jest.mocked(Keyboard.isVisible).mockReturnValueOnce(true);
  await actOn(() => rendered.root.findByType(TopBar).props.onBack());
  expect(dismissKeyboard).toHaveBeenCalledTimes(1);
  expect(Alert.alert).not.toHaveBeenCalled();
  expect(cancel).not.toHaveBeenCalled();
  await actOn(() => rendered.root.findByType(TopBar).props.onBack());
  const [title, , actions] = jest.mocked(Alert.alert).mock.calls[0];
  expect(title).toBe('Discard your changes?');
  expect(actions?.find((action) => action.text === 'Keep editing')?.style).toBe('cancel');
  expect(cancel).not.toHaveBeenCalled();
  await actOn(() => actions?.find((action) => action.text === 'Discard')?.onPress?.());
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(save).not.toHaveBeenCalled();
  await act(async () => rendered.unmount());
  await mount();
  expect(field('Pilot name').props.value).toBe('Saved Pilot');
  expect(field('General pilot reference — optional').props.value).toBe('PRIVATE-REF');
  expect(sheet().dirty).toBe(false);
});

it('ignores a late save result after dismissal instead of closing a subsequently opened editor', async () => {
  let finish!: () => void;
  save.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  await mount();
  await actOn(() => sheet().onSave());
  await actOn(() => rendered.root.findByType(TopBar).props.onBack());
  const [title, message, actions] = jest.mocked(Alert.alert).mock.calls[0];
  expect(title).toBe('Leave while saving?');
  expect(message).toContain('does not cancel the save');
  await actOn(() => actions?.find((action) => action.text === 'Leave')?.onPress?.());
  expect(cancel).toHaveBeenCalledTimes(1);
  await act(async () => rendered.unmount());
  await mount();
  await actOn(() => field('Pilot name').props.onChangeText('New visit draft'));
  await actOn(finish);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(field('Pilot name').props.value).toBe('New visit draft');
});

it.each(['  Josée: Test\nPilot  ', '   ', '翼'])('previews the actual export pilot header for %p without exporting private references', async (name) => {
  await mount();
  await actOn(() => field('Pilot name').props.onChangeText(name));
  const emitted = buildUnsignedIgc({ id: 'synthetic-session', startedAt: 1000, endedAt: 3000 }, [{
    sessionId: 'synthetic-session', sequence: 1, callbackId: 'callback', batchIndex: 0,
    sourceTimestamp: 2000, receiptTimestamp: 2001, latitude: 1, longitude: 103,
    gpsAltitude: 10, verticalAccuracy: 1, horizontalAccuracy: 1, speed: 0, heading: 0, mocked: false,
  }], equipmentExportHeaders({ version: 1, capturedAt: 1000, aircraftId: 'captured-wing',
    sport: 'hang_gliding', model: 'Recorded Wing', size: '155', registrationId: 'AIRCRAFT-ID' },
  { ...saved, pilotName: name })).content;
  const pilotLine = emitted.split('\r\n').find((line) => line.startsWith('HFPLTPILOTINCHARGE:'));
  const previewLines = rendered.root.findAll((node: TestNode) => Array.isArray(node.props.children)
    && node.props.children[0] === 'HFPLTPILOTINCHARGE:')
    .map((node: TestNode) => node.props.children.join(''));
  expect(previewLines.length).toBeGreaterThan(0);
  expect(new Set(previewLines)).toEqual(new Set([pilotLine]));
  expect(emitted).toContain('HFGTYGLIDERTYPE:RECORDED WING\r\n');
  expect(emitted).toContain('HFGIDGLIDERID:AIRCRAFT-ID\r\n');
  expect(emitted).not.toContain('PRIVATE-REF');
  expect(emitted).not.toContain('LEGACY');
  expect(emitted).not.toContain('HFCID');
  expect(save).not.toHaveBeenCalled();
});
