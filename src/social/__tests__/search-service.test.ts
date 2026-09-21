import { createSocialService } from '../service';
import { normalizePilotQuery, normalizeSocialUsername, parsePilotSearchPage } from '../validation';

const id = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const input = { displayName: 'Pilot', username: 'pilot', discoverable: false };
const row = { userId: id, displayName: 'Pilot One', username: 'pilot_one', relationshipId: null, relationshipState: 'none' as const };
const page = { status: 'ok', items: [row], nextCursor: null };
const signal = () => new AbortController().signal;
let rpc: jest.Mock;
let service: ReturnType<typeof createSocialService>;
beforeEach(() => { rpc = jest.fn().mockResolvedValue({ data: page, error: null }); service = createSocialService(rpc); });

it('sends a normalized literal query with no wildcard expansion', async () => {
  await service.searchPilots('  PiLoT   %_  ', null, signal());
  expect(rpc).toHaveBeenLastCalledWith({ name: 'social_search_pilots', args: { p_query: 'pilot %_', p_cursor: null } }, expect.any(AbortSignal));
  expect(normalizePilotQuery(' @PiLot_One ')).toBe('@pilot_one');
});
it('counts query codepoints after optional @ and preserves it for username-only search', async () => {
  expect(normalizePilotQuery('@🪂🪂')).toBe('@🪂🪂');
  expect(normalizePilotQuery('@' + 'a'.repeat(60))).toHaveLength(61);
  for (const query of ['a', '@a', '  ', 'a'.repeat(61), '@' + 'a'.repeat(61)]) {
    await expect(service.searchPilots(query, null, signal())).rejects.toMatchObject({ code: 'invalid_input' });
  }
  expect(rpc).not.toHaveBeenCalled();
});
it('preserves valid exact-match cursors and rejects pagination for another query before dispatch', async () => {
  const cursor = { query: '@pilot_one', rank: 0 as const, username: 'pilot_one', userId: id };
  await service.searchPilots(' @PILOT_ONE ', cursor, signal());
  expect(rpc.mock.calls[0][0].args.p_cursor).toEqual(cursor);
  await expect(service.searchPilots('different', cursor, signal())).rejects.toMatchObject({ code: 'invalid_input' });
  expect(rpc).toHaveBeenCalledTimes(1);
});
it('copies only approved result fields and relationship context', () => {
  expect(parsePilotSearchPage({ ...page, secret: 'private', items: [{ ...row, email: 'private', notes: 'private' }] }, 'pilot')).toEqual(page);
  expect(parsePilotSearchPage({ ...page, items: [{ ...row, relationshipId: other, relationshipState: 'incoming' }] }, 'pilot').items[0])
    .toMatchObject({ relationshipId: other, relationshipState: 'incoming' });
});
it.each([['@pilot_one', 0], ['pilot', 1]] as const)('accepts a page continuation for %s with rank %i', (query, rank) => {
  const nextCursor = { query, rank, username: row.username, userId: row.userId };
  expect(parsePilotSearchPage({ ...page, nextCursor }, query)).toEqual({ ...page, nextCursor });
});
it('returns rate limiting as a distinct empty page, not a failed lookup or fabricated match', async () => {
  const limited = { status: 'rate_limited', items: [], nextCursor: null };
  rpc.mockResolvedValue({ data: limited, error: null });
  await expect(service.searchPilots('pilot', null, signal())).resolves.toEqual(limited);
});
it.each([
  null,
  { ...page, status: 'success' },
  { ...page, items: null },
  { ...page, items: Array(21).fill(row) },
  { ...page, items: [row, row] },
  { ...page, items: [{ ...row, username: null }] },
  { ...page, items: [{ ...row, username: 'UPPERCASE' }] },
  { ...page, items: [{ ...row, userId: 'private-identity' }] },
  { ...page, items: [{ ...row, relationshipState: 'blocked' }] },
  { ...page, items: [{ ...row, relationshipState: 'accepted' }] },
  { ...page, items: [{ ...row, relationshipId: other }] },
  { ...page, nextCursor: { query: 'other', rank: 1, username: 'pilot_one', userId: id } },
  { ...page, nextCursor: { query: 'pilot', rank: 0, username: 'pilot_one', userId: id } },
  { ...page, nextCursor: { query: 'pilot', rank: 1, username: 'pilot_one', userId: other } },
  { ...page, status: 'rate_limited' },
])('rejects malformed or inconsistent search JSON %#', async data => {
  rpc.mockResolvedValue({ data, error: null });
  await expect(service.searchPilots('pilot', null, signal())).rejects.toMatchObject({ code: 'invalid_response' });
});
it.each(['ab', 'a'.repeat(25), 'has space', 'pilot-name', 'éclair', '@@pilot'])('rejects invalid username %s before any request', async username => {
  await expect(service.saveProfile({ ...input, username }, signal())).rejects.toMatchObject({ code: 'invalid_input' });
  expect(rpc).not.toHaveBeenCalled();
});
it('accepts username length boundaries and does not infer discovery consent', async () => {
  expect(normalizeSocialUsername(' @_Ab ')).toBe('_ab');
  expect(normalizeSocialUsername('A'.repeat(24))).toBe('a'.repeat(24));
  await expect(service.saveProfile({ ...input, discoverable: undefined! }, signal())).rejects.toMatchObject({ code: 'invalid_input' });
  expect(rpc).not.toHaveBeenCalled();
});
it('maps a username conflict to an editable error and supports retry', async () => {
  rpc.mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'private SQL detail' } });
  await expect(service.saveProfile(input, signal())).rejects.toThrow('That username is already taken');
  rpc.mockResolvedValueOnce({ data: null, error: null });
  await expect(service.saveProfile({ ...input, username: 'another_pilot' }, signal())).resolves.toBeUndefined();
});
it('dispatches discovery block without a fabricated friendship and maps denial', async () => {
  rpc.mockResolvedValueOnce({ data: null, error: null });
  await service.blockPilot(id, signal());
  expect(rpc).toHaveBeenCalledWith({ name: 'social_block_pilot', args: { p_user_id: id } }, expect.any(AbortSignal));
  rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'private detail' } });
  await expect(service.blockPilot(id, signal())).rejects.toMatchObject({ code: 'unavailable' });
  await expect(service.searchPilots('pilot', null, signal())).rejects.toMatchObject({ code: 'unavailable' });
});
it('propagates cancellation to the transport and rejects its late successful page', async () => {
  let finish!: (value: unknown) => void;
  rpc.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const abort = new AbortController();
  const request = service.searchPilots('pilot', null, abort.signal);
  abort.abort();
  expect(rpc.mock.calls[0][1].aborted).toBe(true);
  finish({ data: page, error: null });
  await expect(request).rejects.toMatchObject({ code: 'stale' });
});
it('aborts a timed-out search and maps it to a retryable connection error', async () => {
  jest.useFakeTimers();
  try {
    rpc.mockImplementation((_request, abort: AbortSignal) => new Promise((_resolve, reject) => {
      abort.addEventListener('abort', () => reject(new Error('raw transport error')));
    }));
    const request = service.searchPilots('pilot', null, signal());
    const rejected = expect(request).rejects.toMatchObject({ code: 'request_failed' });
    await jest.advanceTimersByTimeAsync(20_000);
    await rejected;
  } finally { jest.useRealTimers(); }
});
