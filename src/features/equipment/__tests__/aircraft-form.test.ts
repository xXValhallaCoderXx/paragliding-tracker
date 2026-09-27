import React from 'react';
import { Alert, Keyboard, Switch } from 'react-native';
import { Button, Input, Notice } from '@/components/ui';
import type { EquipmentInventory } from '@/equipment/types';
import { AircraftForm } from '../aircraft-form';
import { FormSheet, dismissDraft } from '../form-sheet';
import { create, act } from '../../../../tests/support/renderer';

jest.mock('@/lib/use-reduced-motion', () => ({ useReducedMotion: () => false }));
jest.mock('@/components/ui', () => Object.fromEntries([
  'Button', 'Card', 'Input', 'Notice', 'SectionLabel', 'Screen', 'TopBar',
].map((name) => [name, ({ children }: { children?: React.ReactNode }) => children ?? null])));

function inventory(): EquipmentInventory {
  return { owner: 'guest', aircraft: [], identities: [
    { kind: 'sport', id: 'paragliding', value: { sport: 'paragliding', pilotIdentifier: 'APPI 100' }, generation: 3, serverRevision: 2, pending: false, conflict: null },
  ], selection: { kind: 'selection', id: 'current', value: { aircraftId: null }, generation: 4, serverRevision: 0, pending: false, conflict: null } };
}
let rendered: ReturnType<typeof create>;
let data: EquipmentInventory;
let save: jest.Mock;
let close: jest.Mock;
let archive: jest.Mock;
let reload: jest.Mock;
function field(label: string) { return rendered.root.findAllByType(Input).find((node: any) => node.props.label === label)!; }
function button(label: string) { return rendered.root.findAllByType(Button).find((node: any) => node.props.label === label)!; }
async function press(callback: () => void) { await act(async () => callback()); }
async function sport(label: string) { await press(() => rendered.root.findAllByProps({ accessibilityRole: 'radio', accessibilityLabel: label })[0]!.props.onPress()); }
async function mount(edit = false) {
  await act(async () => { rendered = create(React.createElement(AircraftForm, { inventory: data,
    aircraft: edit ? data.aircraft[0] : undefined, profile: null, onSave: save, onArchive: archive, onReload: reload, onClose: close })); });
}
beforeEach(() => {
  data = inventory(); reload = jest.fn(); save = jest.fn().mockResolvedValue(undefined); close = jest.fn(); archive = jest.fn().mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.spyOn(Keyboard, 'isVisible').mockReturnValue(false);
});
afterEach(async () => { if (rendered) await act(async () => rendered.unmount()); jest.restoreAllMocks(); });

it('requires an explicit sport and model, retains manual names, and never copies identifiers between sports', async () => {
  await mount();
  await press(() => rendered.root.findByType(FormSheet).props.onSave());
  expect(save).not.toHaveBeenCalled();
  expect(rendered.root.findByType(Notice).props.children).toContain('Choose a sport');
  await sport('Paraglider');
  expect(button('Edit pilot identifier')).toBeDefined();
  await sport('Hang glider');
  expect(field('Pilot identifier — optional').props.value).toBe('');
  await press(() => field('Make and model').props.onChangeText('  Custom Wing  '));
  await press(() => field('Size — optional').props.onChangeText(' 155 '));
  await press(() => rendered.root.findByType(FormSheet).props.onSave());
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ owner: 'guest', sport: 'hang_gliding', model: 'Custom Wing',
    size: '155', registrationId: null, makeCurrent: true, expectedSelectionGeneration: 4,
    identity: { pilotIdentifier: null, expectedGeneration: 0 } }));
  expect(close).toHaveBeenCalledTimes(1);
});

it('keeps an existing sport identifier untouched until Edit is explicitly selected', async () => {
  await mount(); await sport('Paraglider');
  await press(() => field('Make and model').props.onChangeText('Ozone Rush 6'));
  await press(() => rendered.root.findByType(FormSheet).props.onSave());
  expect(save.mock.calls[0][0]).not.toHaveProperty('identity');
});

it('guards immediate duplicate save, retains drafts on failures, and ignores a dismissed request completion', async () => {
  let fail!: (error: Error) => void;
  save.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  await mount(); await sport('Speedwing');
  await press(() => field('Make and model').props.onChangeText('Synthetic wing'));
  await press(() => { const submit = rendered.root.findByType(FormSheet).props.onSave; submit(); submit(); });
  expect(save).toHaveBeenCalledTimes(1);
  expect(field('Make and model').props.editable).toBe(false);
  await press(() => fail(new Error('Disk unavailable')));
  expect(field('Make and model').props.value).toBe('Synthetic wing');
  expect(rendered.root.findByType(Notice).props.children).toBe('Disk unavailable');
  let finish!: () => void;
  save.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  await press(() => rendered.root.findByType(FormSheet).props.onSave());
  await act(async () => rendered.unmount());
  await press(finish);
  expect(close).not.toHaveBeenCalled();
});

it('requires confirmation before archiving the current aircraft and passes its captured generation', async () => {
  data.aircraft = [{ kind: 'aircraft', id: 'wing', value: { id: 'wing', model: 'Synthetic wing', sport: 'paragliding',
    size: null, registrationId: null, archived: false }, generation: 6, serverRevision: 0, pending: true, conflict: null }];
  data.selection.value.aircraftId = 'wing';
  await mount(true);
  expect(rendered.root.findByType(Switch).props.value).toBe(true);
  await press(() => button('Archive aircraft').props.onPress());
  expect(archive).not.toHaveBeenCalled();
  const [, message, actions] = jest.mocked(Alert.alert).mock.calls[0];
  expect(message).toContain('clear the current aircraft');
  await press(() => actions?.find((action) => action.text === 'Archive')?.onPress?.());
  expect(archive).toHaveBeenCalledWith(data.aircraft[0], true);
});

it('dismisses the keyboard first and confirms dirty cancellation without saving', () => {
  const dismiss = jest.spyOn(Keyboard, 'dismiss').mockImplementation(() => undefined);
  jest.mocked(Keyboard.isVisible).mockReturnValueOnce(true);
  dismissDraft(true, close);
  expect(dismiss).toHaveBeenCalledTimes(1); expect(Alert.alert).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
  dismissDraft(true, close);
  const actions = jest.mocked(Alert.alert).mock.calls[0][2];
  expect(actions?.find((action) => action.text === 'Keep editing')?.style).toBe('cancel');
  actions?.find((action) => action.text === 'Discard')?.onPress?.();
  expect(close).toHaveBeenCalledTimes(1); expect(save).not.toHaveBeenCalled();
});

it('explains that leaving a submitted save does not cancel it', () => {
  dismissDraft(true, close, true);
  const [title, message, actions] = jest.mocked(Alert.alert).mock.calls[0];
  expect(title).toBe('Leave while saving?');
  expect(message).toContain('does not cancel the save');
  expect(actions?.some((action) => action.text === 'Discard')).toBe(false);
  actions?.find((action) => action.text === 'Leave')?.onPress?.();
  expect(close).toHaveBeenCalledTimes(1);
});

it('preserves a stale draft and updates expected generations only after reviewing and explicitly keeping edits', async () => {
  data.aircraft = [{ kind: 'aircraft', id: 'wing', value: { id: 'wing', model: 'Original wing', sport: 'paragliding',
    size: null, registrationId: null, archived: false }, generation: 2, serverRevision: 0, pending: true, conflict: null }];
  data.selection.value.aircraftId = 'wing';
  save.mockRejectedValueOnce(new Error('These aircraft details changed. Review the latest details and try again.'));
  const latest = structuredClone(data);
  latest.aircraft[0]!.generation = 8;
  latest.aircraft[0]!.value.model = 'New saved name';
  latest.selection.generation = 9;
  latest.identities[0]!.generation = 10;
  latest.identities[0]!.value.pilotIdentifier = 'New saved ID';
  reload.mockResolvedValue(latest);
  await mount(true);
  await press(() => field('Make and model').props.onChangeText('My retained draft'));
  await press(() => button('Edit pilot identifier').props.onPress());
  await press(() => field('Pilot identifier — optional').props.onChangeText('My identifier'));
  await press(() => rendered.root.findByType(FormSheet).props.onSave());
  expect(field('Make and model').props.value).toBe('My retained draft');
  expect(save.mock.calls[0][0]).toMatchObject({ expectedGeneration: 2, expectedSelectionGeneration: 4, identity: { expectedGeneration: 3 } });
  await press(() => button('Review latest saved details').props.onPress());
  expect(reload).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledTimes(1);
  await press(() => rendered.root.findByType(FormSheet).props.onSave());
  expect(save).toHaveBeenCalledTimes(1);
  await press(() => button('Keep my edits').props.onPress());
  expect(field('Make and model').props.value).toBe('My retained draft');
  expect(field('Pilot identifier — optional').props.value).toBe('My identifier');
  expect(save).toHaveBeenCalledTimes(1);
  await press(() => rendered.root.findByType(FormSheet).props.onSave());
  expect(save.mock.calls[1][0]).toMatchObject({ model: 'My retained draft', expectedGeneration: 8,
    expectedSelectionGeneration: 9, identity: { pilotIdentifier: 'My identifier', expectedGeneration: 10 } });
});

it.each(['owner', 'archived', 'conflict'] as const)('never rebases a draft across an %s change', async (change) => {
  data.aircraft = [{ kind: 'aircraft', id: 'wing', value: { id: 'wing', model: 'Original wing', sport: 'paragliding',
    size: null, registrationId: null, archived: false }, generation: 2, serverRevision: 0, pending: true, conflict: null }];
  save.mockRejectedValueOnce(new Error('Details changed'));
  const latest = structuredClone(data);
  if (change === 'owner') latest.owner = 'different-account';
  if (change === 'archived') latest.aircraft[0]!.value.archived = true;
  if (change === 'conflict') latest.aircraft[0]!.conflict = { kind: 'aircraft', id: 'wing', revision: 4, value: latest.aircraft[0]!.value };
  reload.mockResolvedValue(latest);
  await mount(true);
  await press(() => field('Make and model').props.onChangeText('Keep this draft'));
  await press(() => rendered.root.findByType(FormSheet).props.onSave());
  await press(() => button('Review latest saved details').props.onPress());
  expect(button('Keep my edits')).toBeUndefined();
  expect(field('Make and model').props.value).toBe('Keep this draft');
  expect(rendered.root.findByType(Notice).props.children).toContain(change === 'owner' ? 'cannot be moved' : change === 'archived' ? 'restore it' : 'Resolve the other-device');
  expect(save).toHaveBeenCalledTimes(1);
});
