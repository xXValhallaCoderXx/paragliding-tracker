import { createFeedService } from '../feed-service';
import { parseKudosPage, parseKudosSummary, parseSharedFlight } from '../feed-validation';
import { A, B, C, flight } from './feed-fixtures';

const page = () => ({ activityId: A, count: 2, givenByMe: true,
  items: [{ id: B, displayName: 'Same name' }, { id: C, displayName: 'Same name' }],
  nextCursor: { createdAt: '2026-09-21T01:00:00.123456+00:00', id: C } });
const signal = () => new AbortController().signal;

it('keeps older feed responses usable without inventing a zero kudos count', () => {
  const { kudos: _kudos, ...oldResponse } = flight();
  expect(parseSharedFlight(oldResponse).kudos).toBeNull();
  expect(parseSharedFlight({ ...oldResponse, kudos: { count: 3, givenByMe: true } }).kudos)
    .toEqual({ count: 3, givenByMe: true });
});

it('projects only reaction identities and social names, preserving duplicate names and cursor precision', () => {
  const source = page();
  const response = parseKudosPage({ ...source, items: source.items.map(item => ({ ...item,
    reactorId: A, email: 'private@example.test', backedUpFlightCount: 42 })) });
  expect(response).toEqual(source);
  expect(response.items.map(item => Object.keys(item).sort())).toEqual([['displayName', 'id'], ['displayName', 'id']]);
});

it.each([
  { count: -1, givenByMe: false }, { count: 1.5, givenByMe: false },
  { count: 0, givenByMe: true }, { count: 1, givenByMe: 'true' },
])('rejects an impossible or unconfirmed count %#', value => {
  expect(() => parseKudosSummary(value)).toThrow();
});

it.each([
  { ...page(), items: [{ id: B, displayName: ' ' }] },
  { ...page(), items: [{ id: B, displayName: 'a'.repeat(61) }] },
  { ...page(), items: [{ id: B, displayName: 'One' }, { id: B, displayName: 'Two' }] },
  { ...page(), count: 1 },
  { ...page(), nextCursor: { createdAt: page().nextCursor.createdAt, id: A } },
  { ...page(), items: [] },
])('rejects malformed or inconsistent supporter pages %#', value => {
  expect(() => parseKudosPage(value)).toThrow();
});

it('sends a desired state rather than a toggle and confirms the correct flight and state', async () => {
  const rpc = jest.fn().mockResolvedValue({ data: { activityId: A, count: 1, givenByMe: true }, error: null });
  const service = createFeedService({ rpc, edge: jest.fn() });
  await expect(service.setKudos(A, true, signal())).resolves.toEqual({ activityId: A, count: 1, givenByMe: true });
  expect(rpc.mock.calls[0][0]).toEqual({ name: 'social_set_kudos', args: { p_activity_id: A, p_given: true } });
  rpc.mockResolvedValue({ data: { activityId: B, count: 1, givenByMe: true }, error: null });
  await expect(service.setKudos(A, true, signal())).rejects.toMatchObject({ code: 'invalid_response' });
  rpc.mockResolvedValue({ data: { activityId: A, count: 0, givenByMe: false }, error: null });
  await expect(service.setKudos(A, true, signal())).rejects.toMatchObject({ code: 'invalid_response' });
});

it('requests bounded pages with the exact cursor and rejects another activity', async () => {
  const rpc = jest.fn().mockResolvedValue({ data: page(), error: null });
  const service = createFeedService({ rpc, edge: jest.fn() });
  await service.getKudos(A, page().nextCursor, signal());
  expect(rpc.mock.calls[0][0]).toEqual({ name: 'social_list_kudos', args: { p_activity_id: A,
    p_cursor_created_at: page().nextCursor.createdAt, p_cursor_id: C, p_limit: 25 } });
  rpc.mockResolvedValue({ data: { ...page(), activityId: B }, error: null });
  await expect(service.getKudos(A, null, signal())).rejects.toMatchObject({ code: 'invalid_response' });
});

it('distinguishes older-server support and self-kudos from revoked flight access', async () => {
  const rpc = jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202' } });
  const service = createFeedService({ rpc, edge: jest.fn() });
  await expect(service.getKudos(A, null, signal())).rejects.toMatchObject({ code: 'unsupported' });
  await expect(service.setKudos(A, true, signal())).rejects.toMatchObject({ code: 'unsupported' });
  rpc.mockResolvedValue({ data: null, error: { code: 'P0001', message: 'kudos_self_not_allowed' } });
  await expect(service.setKudos(A, true, signal())).rejects.toMatchObject({ code: 'invalid_input' });
  rpc.mockResolvedValue({ data: null, error: { code: '42501' } });
  await expect(service.getKudos(A, null, signal())).rejects.toMatchObject({ code: 'unavailable' });
});

it('ignores successful mutation responses after the request was aborted', async () => {
  const controller = new AbortController();
  const rpc = jest.fn().mockImplementation(async () => {
    controller.abort(); return { data: { activityId: A, count: 1, givenByMe: true }, error: null };
  });
  const service = createFeedService({ rpc, edge: jest.fn() });
  await expect(service.setKudos(A, true, controller.signal)).rejects.toMatchObject({ code: 'stale' });
});
