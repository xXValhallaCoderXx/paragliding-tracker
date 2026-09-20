import { createFeedService, feedError, type FeedTransport } from '../feed-service';
import { A, G, artifact, flight } from './feed-fixtures';
let rpc: jest.Mock;
let edge: jest.Mock;
let service: ReturnType<typeof createFeedService>;
beforeEach(() => { rpc = jest.fn(); edge = jest.fn(); service = createFeedService({ rpc, edge } as FeedTransport); });
it('requests only the narrow feed RPC with the stable cursor', async () => {
  rpc.mockResolvedValue({ data: { items: [flight()], nextCursor: null }, error: null });
  const cursor = { activityId: A, publishedAt: flight().publishedAt };
  await service.getFeed(cursor, new AbortController().signal);
  expect(rpc.mock.calls[0][0]).toEqual({ name: 'social_list_feed', args: { p_cursor_activity_id: A, p_cursor_published_at: cursor.publishedAt, p_limit: 25 } });
});
it('verifies replay hash and byte length before returning points', async () => {
  edge.mockResolvedValue({ data: artifact, error: null, sha256: 'wrong', byteCount: 300 });
  await expect(service.getReplay(A, flight().artifact, new AbortController().signal)).rejects.toMatchObject({ code: 'invalid_response' });
  edge.mockResolvedValue({ data: artifact, error: null, sha256: 'a'.repeat(64), byteCount: 300 });
  await expect(service.getReplay(A, flight().artifact, new AbortController().signal)).resolves.toEqual(artifact);
  expect(edge.mock.calls[1][0]).toEqual({ action: 'read', activityId: A, generation: G });
});
it('rejects another activity and refuses to confirm an unacknowledged hide', async () => {
  rpc.mockResolvedValue({ data: { ...flight(), activityId: G }, error: null });
  await expect(service.getDetail(A, new AbortController().signal)).rejects.toMatchObject({ code: 'invalid_response' });
  rpc.mockResolvedValue({ data: { flightId: A, activityId: A, revision: 1, state: 'shared' }, error: null });
  await expect(service.hideFlight(A, new AbortController().signal)).rejects.toMatchObject({ code: 'invalid_response' });
});
it('does not turn aborted requests into successful data even if transport ignores abort', async () => {
  const controller = new AbortController();
  rpc.mockImplementation(async () => { controller.abort(); return { data: { enabled: false, generation: null }, error: null }; });
  await expect(service.getPreferences(controller.signal)).rejects.toMatchObject({ code: 'stale' });
});
it.each(['consent_changed', 'publication_changed', 'flight_not_ready', 'profile_required', 'account_deleting'] as const)('keeps actionable %s errors for the durable worker', code => {
  expect(feedError({ message: `shared_${code}` }).code).toBe(code);
});
it('blocks a replay artifact containing private fields before upload', async () => {
  await expect(service.uploadShare({ activityId: A, uploadToken: G, revision: 1, alreadyPublished: false }, { ...artifact, notes: 'secret' } as typeof artifact, new AbortController().signal)).rejects.toMatchObject({ code: 'invalid_response' });
  expect(edge).not.toHaveBeenCalled();
});
