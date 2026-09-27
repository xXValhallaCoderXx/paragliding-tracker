import type { EquipmentMutation } from '@/equipment/types';
import { equipmentPending, parseEquipmentEntity, syncEquipment } from '../equipment-sync';

const mockRepository = {
  getActiveOwner: jest.fn(), getInventory: jest.fn(), applyRemote: jest.fn(), listPending: jest.fn(),
  acknowledge: jest.fn(), recordSyncFailure: jest.fn(),
  isPending: jest.fn(),
};
jest.mock('@/equipment/repository', () => ({ get equipmentRepository() { return mockRepository; } }));
const mockRpc = jest.fn();
const mockSession = jest.fn();
const mockHeader = jest.fn();
jest.mock('../supabase', () => ({ getSupabase: () => ({
  auth: { getSession: () => mockSession() },
  rpc: (...args: unknown[]) => ({ setHeader: (name: string, value: string) => { mockHeader(name, value); return mockRpc(...args); } }),
}) }));
const aircraft = { id: 'aaaaaaaa-0000-0000-0000-000000000001', sport: 'paragliding' as const,
  model: 'Rush 6', size: 'M', registrationId: 'D-123', archived: false };
const mutation = (overrides: Partial<EquipmentMutation> = {}): EquipmentMutation => ({ owner: 'A', kind: 'aircraft', id: aircraft.id,
  value: aircraft, operationId: 'aaaaaaaa-1111-1111-1111-000000000001', expectedRevision: 1, generation: 3, ...overrides });
const wire = (revision = 2) => ({ kind: 'aircraft', key: aircraft.id, payload: aircraft, revision });
beforeEach(() => {
  jest.clearAllMocks();
  mockSession.mockResolvedValue({ data: { session: { user: { id: 'A' }, access_token: 'token-A' } }, error: null });
  mockRepository.getActiveOwner.mockResolvedValue('A');
  mockRepository.applyRemote.mockResolvedValue(undefined);
  mockRepository.listPending.mockResolvedValue([mutation()]);
  mockRepository.isPending.mockResolvedValue(true);
  mockRepository.acknowledge.mockResolvedValue(undefined);
  mockRepository.recordSyncFailure.mockResolvedValue(undefined);
  mockRpc.mockImplementation(async name => name === 'read_private_equipment'
    ? { data: { entities: [] }, error: null }
    : { data: { status: 'applied', entity: wire(), related: [] }, error: null });
});
it('reads canonical inventory before dispatching a revisioned private mutation and acknowledges exact generation', async () => {
  const guard = jest.fn();
  await syncEquipment('A', guard);
  expect(mockRepository.applyRemote).toHaveBeenCalledWith('A', [], guard);
  expect(mockRepository.applyRemote.mock.invocationCallOrder[0]).toBeLessThan(mockRepository.listPending.mock.invocationCallOrder[0]!);
  expect(mockRpc).toHaveBeenLastCalledWith('write_private_equipment', { p_kind: 'aircraft', p_key: aircraft.id,
    p_payload: aircraft, p_expected_revision: 1, p_operation_id: mutation().operationId });
  expect(mockRepository.acknowledge).toHaveBeenCalledWith(mutation(), { status: 'applied',
    entity: { kind: 'aircraft', id: aircraft.id, value: aircraft, revision: 2 }, related: [] }, guard);
});
it('does not send bound A inventory to signed-in B', async () => {
  await syncEquipment('B', () => {});
  expect(mockRpc).not.toHaveBeenCalled();
  expect(mockRepository.listPending).not.toHaveBeenCalled();
});
it('pins the verified owner token for both the read and the write', async () => {
  await syncEquipment('A', () => {});
  expect(mockSession).toHaveBeenCalledTimes(1);
  expect(mockHeader.mock.calls).toEqual([['Authorization', 'Bearer token-A'], ['Authorization', 'Bearer token-A']]);
});
it('rejects a different session owner before dispatching any private inventory RPC', async () => {
  mockSession.mockResolvedValue({ data: { session: { user: { id: 'B' }, access_token: 'token-B' } }, error: null });
  await expect(syncEquipment('A', () => {})).rejects.toThrow('account changed');
  expect(mockRpc).not.toHaveBeenCalled();
});
it('skips a selection superseded by the preceding archive acknowledgement', async () => {
  mockRepository.isPending.mockResolvedValue(false);
  await syncEquipment('A', () => {});
  expect(mockRpc).toHaveBeenCalledTimes(1);
  expect(mockRepository.acknowledge).not.toHaveBeenCalled();
});
it('a failed inventory read never becomes permission to overwrite an empty account', async () => {
  mockRpc.mockResolvedValue({ data: null, error: new Error('Offline') });
  await expect(syncEquipment('A', () => {})).rejects.toThrow('Offline');
  expect(mockRepository.applyRemote).not.toHaveBeenCalled();
  expect(mockRepository.listPending).not.toHaveBeenCalled();
});
it('persists conflicts and atomic archive-related selection changes without retrying a new revision', async () => {
  mockRpc.mockImplementation(async name => name === 'read_private_equipment' ? { data: { entities: [] }, error: null }
    : { data: { status: 'conflict', entity: wire(9), related: [{ kind: 'selection', key: 'current', payload: { aircraftId: null }, revision: 4 }] }, error: null });
  await syncEquipment('A', () => {});
  expect(mockRepository.acknowledge).toHaveBeenCalledWith(mutation(), expect.objectContaining({ status: 'conflict',
    entity: expect.objectContaining({ revision: 9 }), related: [{ kind: 'selection', id: 'current', value: { aircraftId: null }, revision: 4 }] }), expect.any(Function));
  expect(mockRpc).toHaveBeenCalledTimes(2);
});
it('rejects an obsolete account response before any durable merge', async () => {
  let current = true;
  mockRpc.mockImplementation(async () => { current = false; return { data: { entities: [wire()] }, error: null }; });
  await expect(syncEquipment('A', () => { if (!current) throw new Error('Account changed'); })).rejects.toThrow('Account changed');
  expect(mockRepository.applyRemote).not.toHaveBeenCalled();
});
it('does not acknowledge a dispatched edit after recorder priority revokes the guard', async () => {
  let current = true;
  mockRpc.mockImplementation(async name => {
    if (name === 'read_private_equipment') return { data: { entities: [] }, error: null };
    current = false;
    return { data: { status: 'applied', entity: wire(), related: [] }, error: null };
  });
  await expect(syncEquipment('A', () => { if (!current) throw new Error('Recording'); })).rejects.toThrow('Recording');
  expect(mockRepository.acknowledge).not.toHaveBeenCalled();
  expect(mockRepository.recordSyncFailure).not.toHaveBeenCalled();
});
it('retains failed mutations and still attempts unrelated aircraft edits', async () => {
  const second = mutation({ id: 'aaaaaaaa-0000-0000-0000-000000000002', value: { ...aircraft, id: 'aaaaaaaa-0000-0000-0000-000000000002' }, operationId: 'aaaaaaaa-1111-1111-1111-000000000002' });
  mockRepository.listPending.mockResolvedValue([mutation(), second]);
  mockRpc.mockImplementation(async (name, args) => name === 'read_private_equipment' ? { data: { entities: [] }, error: null }
    : args.p_key === aircraft.id ? { data: null, error: new Error('Temporary failure') }
    : { data: { status: 'applied', entity: { ...wire(), key: second.id, payload: { ...aircraft, id: second.id } }, related: [] }, error: null });
  await expect(syncEquipment('A', () => {})).rejects.toThrow('Temporary failure');
  expect(mockRepository.recordSyncFailure).toHaveBeenCalledWith(mutation(), 'Temporary failure', expect.any(Function));
  expect(mockRepository.acknowledge).toHaveBeenCalledTimes(1);
});
it('rejects malformed and duplicate remote entities before touching storage', async () => {
  expect(() => parseEquipmentEntity({ ...wire(), revision: 0 })).toThrow('invalid');
  expect(() => parseEquipmentEntity({ ...wire(), payload: { ...aircraft, sport: 'invented' } })).toThrow('invalid');
  mockRpc.mockResolvedValue({ data: { entities: [wire(), wire()] }, error: null });
  await expect(syncEquipment('A', () => {})).rejects.toThrow('invalid');
  expect(mockRepository.applyRemote).not.toHaveBeenCalled();
});
it('counts review conflicts separately so retries do not endlessly resend them', async () => {
  mockRepository.getInventory.mockResolvedValue({ aircraft: [{ pending: true, conflict: null }, { pending: true, conflict: {} }],
    identities: [], selection: { pending: false, conflict: null } });
  expect(await equipmentPending()).toEqual({ pending: 1, conflicts: 1 });
});
