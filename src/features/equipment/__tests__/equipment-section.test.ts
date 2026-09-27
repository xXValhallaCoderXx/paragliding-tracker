import React from 'react';
import { Alert } from 'react-native';
import { Button, Input, Notice } from '@/components/ui';
import { equipmentRepository } from '@/equipment/repository';
import type { EquipmentInventory } from '@/equipment/types';
import { EquipmentSection, SportIdentityForm } from '../equipment-section';
import { FormSheet } from '../form-sheet';
import { AircraftForm } from '../aircraft-form';
import { create, act } from '../../../../tests/support/renderer';

let mockInventory: EquipmentInventory;
let mockError = false;
const mockRetry = jest.fn();
const mockSync = jest.fn();
jest.mock('@/equipment/repository', () => ({ equipmentRepository: {
  getInventory: jest.fn(), saveAircraft: jest.fn(), setArchived: jest.fn(), saveIdentity: jest.fn(), resolveConflict: jest.fn(),
} }));
jest.mock('@/store/endpoints', () => ({ useGetEquipmentInventoryQuery: () => ({ data: mockInventory,
  isLoading: false, isError: mockError, refetch: mockRetry }) }));
jest.mock('@/features/account/cloud-sync-provider', () => ({ useCloudSync: () => ({ requestSync: mockSync }) }));
jest.mock('@/lib/use-reduced-motion', () => ({ useReducedMotion: () => false }));
jest.mock('../aircraft-form', () => ({ AircraftForm: () => null }));
jest.mock('@/components/ui', () => Object.fromEntries([
  'BusyRow', 'Button', 'Card', 'Input', 'Notice', 'SectionLabel', 'Screen', 'TopBar', 'StateLabel',
].map((name) => [name, ({ children }: { children?: React.ReactNode }) => children ?? null])));
let rendered: ReturnType<typeof create>;
function button(label: string) { return rendered.root.findAllByType(Button).find((node: any) => node.props.label === label); }
async function press(callback: () => void) { await act(async () => callback()); }
async function mount() { await act(async () => { rendered = create(React.createElement(EquipmentSection, { ready: true, profile: null })); }); }
beforeEach(() => {
  jest.clearAllMocks(); mockError = false;
  mockInventory = { owner: 'guest', identities: [], aircraft: [], selection: {
    kind: 'selection', id: 'current', value: { aircraftId: null }, generation: 2, serverRevision: 1, pending: false, conflict: null,
  } };
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  jest.mocked(equipmentRepository.saveAircraft).mockResolvedValue(mockInventory);
  jest.mocked(equipmentRepository.setArchived).mockResolvedValue(mockInventory);
  jest.mocked(equipmentRepository.resolveConflict).mockResolvedValue(mockInventory);
});
afterEach(async () => { await act(async () => rendered?.unmount()); jest.restoreAllMocks(); });

it('opens a fresh add form, persists before closing, and requests the existing post-save sync trigger', async () => {
  await mount(); await press(() => button('Add aircraft')!.props.onPress());
  const input = { owner: 'guest', sport: 'paragliding' as const, model: 'Synthetic wing' };
  await press(() => rendered.root.findByType(AircraftForm).props.onSave(input));
  expect(equipmentRepository.saveAircraft).toHaveBeenCalledWith(input);
  expect(mockSync).toHaveBeenCalledWith('post-save');
  await press(() => rendered.root.findByType(AircraftForm).props.onClose());
  expect(rendered.root.findAllByType(AircraftForm)).toHaveLength(0);
  await press(() => button('Add aircraft')!.props.onPress());
  expect(rendered.root.findByType(AircraftForm).props.aircraft).toBeUndefined();
});

it('restores archived aircraft through its captured revision without selecting it by default', async () => {
  mockInventory.aircraft = [{ kind: 'aircraft', id: 'old', value: { id: 'old', sport: 'hang_gliding', model: 'Old wing',
    size: null, registrationId: null, archived: true }, generation: 8, serverRevision: 2, pending: false, conflict: null }];
  await mount(); await press(() => button('Archived aircraft')!.props.onPress());
  await press(() => button('Restore Old wing')!.props.onPress());
  expect(equipmentRepository.setArchived).toHaveBeenCalledWith('guest', 'old', false, 8);
  expect(mockInventory.selection.value.aircraftId).toBeNull();
});

it('shows both conflicting versions and waits for an explicit resolution confirmation', async () => {
  mockInventory.identities = [{ kind: 'sport', id: 'paragliding', value: { sport: 'paragliding', pilotIdentifier: 'Local 12' },
    generation: 4, serverRevision: 2, pending: true,
    conflict: { kind: 'sport', id: 'paragliding', revision: 3, value: { sport: 'paragliding', pilotIdentifier: 'Other 34' } } }];
  await mount();
  const notice = rendered.root.findAllByType(Notice).find((node: any) => node.props.title === 'Equipment changed on another device');
  expect(notice.props.children).toContain('Local 12'); expect(notice.props.children).toContain('Other 34');
  await press(() => button('Review and keep this device’s changes')!.props.onPress());
  expect(equipmentRepository.resolveConflict).not.toHaveBeenCalled();
  const actions = jest.mocked(Alert.alert).mock.calls[0][2];
  await press(() => actions?.find((action) => action.text === 'Keep this device')?.onPress?.());
  expect(equipmentRepository.resolveConflict).toHaveBeenCalledWith('guest', 'sport', 'paragliding', 'keep_local', { generation: 4, remoteRevision: 3 });
});

it('retains a usable retry after a local load failure', async () => {
  mockError = true; await mount();
  await press(() => button('Retry aircraft')!.props.onPress());
  expect(mockRetry).toHaveBeenCalledTimes(1);
});

it('reviews a newly saved sport identifier without replacing the draft and then retries its latest generation', async () => {
  const save = jest.fn().mockRejectedValueOnce(new Error('Details changed')).mockResolvedValue(undefined);
  await act(async () => { rendered = create(React.createElement(SportIdentityForm, {
    inventory: mockInventory, sport: 'paragliding', onSave: save, onClose: jest.fn(),
  })); });
  await press(() => rendered.root.findByType(Input).props.onChangeText('My draft ID'));
  await press(() => rendered.root.findByType(FormSheet).props.onSave());
  expect(save).toHaveBeenLastCalledWith('My draft ID', 0);
  const latest = structuredClone(mockInventory);
  latest.identities = [{ kind: 'sport', id: 'paragliding', value: { sport: 'paragliding', pilotIdentifier: 'Restored ID' },
    generation: 7, serverRevision: 2, pending: false, conflict: null }];
  jest.mocked(equipmentRepository.getInventory).mockResolvedValue(latest);
  await press(() => button('Review latest saved details')!.props.onPress());
  expect(rendered.root.findByType(Input).props.value).toBe('My draft ID');
  await press(() => button('Keep my edits')!.props.onPress());
  expect(save).toHaveBeenCalledTimes(1);
  await press(() => rendered.root.findByType(FormSheet).props.onSave());
  expect(save).toHaveBeenLastCalledWith('My draft ID', 7);
});
