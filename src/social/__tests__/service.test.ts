import { createSocialService } from '../service';
import { normalizeSocialName, parseSocialState } from '../validation';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const relation = { id: '33333333-3333-4333-8333-333333333333', userId: other, displayName: 'Friend', state: 'accepted' as const };
const profile = { userId: owner, displayName: 'Pilot', backedUpFlightCount: 12 };
const state = { profile, inviteCode: 'ABCD2345EFGH', relationships: [relation] };
const signal = () => new AbortController().signal;
let rpc: jest.Mock;
let service: ReturnType<typeof createSocialService>;
beforeEach(() => { rpc = jest.fn().mockResolvedValue({ data: state, error: null }); service = createSocialService(rpc); });

it('validates and copies the state DTO without exposing extra backend fields', async () => {
  rpc.mockResolvedValue({ data: { ...state, email: 'private', profile: { ...profile, notes: 'private' } }, error: null });
  expect(await service.getState(signal())).toEqual(state);
});
it.each([
  null,
  { ...state, profile: { ...profile, backedUpFlightCount: -1 } },
  { ...state, profile: { ...profile, backedUpFlightCount: 1.5 } },
  { ...state, profile: { ...profile, userId: 'not-a-user' } },
  { ...state, profile: { ...profile, displayName: ' ' } },
  { ...state, inviteCode: 'short' },
  { ...state, relationships: [{ ...relation, state: 'rejected' }] },
  { ...state, relationships: [relation, relation] },
  { ...state, relationships: null },
])('rejects malformed state JSON %#', async data => {
  rpc.mockResolvedValue({ data, error: null });
  await expect(service.getState(signal())).rejects.toMatchObject({ code: 'invalid_response' });
});
it('supports an explicit profile opt-in with no preexisting code', () => {
  expect(parseSocialState({ profile: null, inviteCode: null, relationships: [] })).toEqual({ profile: null, inviteCode: null, relationships: [] });
});
it('normalizes display names by Unicode codepoints and invite-code case/separators', async () => {
  rpc.mockResolvedValue({ data: null, error: null });
  await service.saveProfile('  Pilot   One  ', signal());
  expect(rpc).toHaveBeenLastCalledWith({ name: 'social_save_profile', args: { p_display_name: 'Pilot One' } }, expect.any(AbortSignal));
  expect(normalizeSocialName('🪂'.repeat(60))).toHaveLength(120);
  expect(() => normalizeSocialName('🪂'.repeat(61))).toThrow('60');
  rpc.mockResolvedValue({ data: { status: 'sent' }, error: null });
  expect(await service.requestFriend('abcd-2345 efgh', signal())).toBe('sent');
  expect(rpc).toHaveBeenLastCalledWith({ name: 'social_request_friend', args: { p_code: 'ABCD2345EFGH' } }, expect.any(AbortSignal));
});
it('does not dispatch invalid input', async () => {
  await expect(service.saveProfile(' ', signal())).rejects.toMatchObject({ code: 'invalid_input' });
  await expect(service.requestFriend('guess', signal())).rejects.toMatchObject({ code: 'invalid_input' });
  expect(rpc).not.toHaveBeenCalled();
});
it.each(['sent', 'incoming', 'outgoing', 'accepted', 'unavailable', 'rate_limited'] as const)('preserves request result %s', async status => {
  rpc.mockResolvedValue({ data: { status }, error: null });
  expect(await service.requestFriend(state.inviteCode, signal())).toBe(status);
});
it('requires a recognized request status and a valid rotated code', async () => {
  rpc.mockResolvedValue({ data: { status: 'success' }, error: null });
  await expect(service.requestFriend(state.inviteCode, signal())).rejects.toMatchObject({ code: 'invalid_response' });
  rpc.mockResolvedValue({ data: null, error: null });
  await expect(service.rotateInviteCode(signal())).rejects.toMatchObject({ code: 'invalid_response' });
});
it.each(['accept', 'decline', 'cancel', 'remove'] as const)('sends the exact relation ID for %s', async action => {
  rpc.mockResolvedValue({ data: null, error: null });
  await service.changeRelationship(relation, action, signal());
  expect(rpc).toHaveBeenCalledWith({ name: 'social_change_relationship', args: {
    p_other_user_id: other, p_action: action, p_request_id: relation.id,
  } }, expect.any(AbortSignal));
});
it.each(['block', 'unblock'] as const)('does not tie %s to an obsolete request', async action => {
  rpc.mockResolvedValue({ data: null, error: null });
  await service.changeRelationship(relation, action, signal());
  expect(rpc.mock.calls[0][0].args).toEqual({ p_other_user_id: other, p_action: action });
});
it('distinguishes an inaccessible profile from connectivity and withholds raw backend messages', async () => {
  rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'private SQL detail' } });
  await expect(service.getFriendProfile(other, signal())).rejects.toThrow('This profile is no longer available. Refresh Friends.');
  await expect(service.getState(signal())).rejects.toThrow('Could not reach Friends');
  rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'private SQL detail' } });
  await expect(service.getState(signal())).rejects.toThrow('Friends is not available on this server yet');
  rpc.mockRejectedValue(new Error('private network detail'));
  await expect(service.getState(signal())).rejects.toThrow('Could not reach Friends');
});
it('rejects the wrong friend identity', async () => {
  rpc.mockResolvedValue({ data: profile, error: null });
  await expect(service.getFriendProfile(other, signal())).rejects.toMatchObject({ code: 'invalid_response' });
});
it('rejects a late successful mutation after cancellation', async () => {
  let complete!: (value: unknown) => void;
  rpc.mockReturnValue(new Promise(resolve => { complete = resolve; }));
  const controller = new AbortController();
  const request = service.rotateInviteCode(controller.signal);
  controller.abort();
  complete({ data: 'ABCD2345EFGH', error: null });
  await expect(request).rejects.toMatchObject({ code: 'stale' });
});
