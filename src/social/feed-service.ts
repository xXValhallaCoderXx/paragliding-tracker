import type { FeedService, PreparedShare, SharedReplayArtifactV1 } from './feed-types';
import { MAX_SHARED_ARTIFACT_BYTES, parseFeedPage, parseManifest, parsePreparedShare, parsePublication, parseSharedFlight, parseSharedReplay, parseSharingPreferences } from './feed-validation';
import { assertSocialUserId } from './validation';
import { SocialError } from './types';

export type FeedRpcRequest =
  | { name: 'social_get_sharing_preferences'; args?: undefined }
  | { name: 'social_set_auto_share'; args: { p_enabled: boolean } }
  | { name: 'social_list_feed'; args: { p_cursor_published_at: string | null; p_cursor_activity_id: string | null; p_limit: number } }
  | { name: 'social_get_activity'; args: { p_activity_id: string } }
  | { name: 'social_get_my_publication'; args: { p_flight_id: string } }
  | { name: 'social_prepare_share'; args: { p_flight_id: string; p_operation_id: string; p_mode: 'automatic' | 'manual'; p_consent_generation: string | null; p_expected_revision: number } }
  | { name: 'social_hide_flight'; args: { p_flight_id: string } };
export type FeedEdgeRequest =
  | { action: 'upload'; activityId: string; uploadToken: string; artifact: SharedReplayArtifactV1 }
  | { action: 'read'; activityId: string; generation: string }
  | { action: 'cleanup' };
export interface FeedTransport {
  rpc(request: FeedRpcRequest, signal: AbortSignal): PromiseLike<{ data: unknown; error: unknown }>;
  edge(request: FeedEdgeRequest, signal: AbortSignal): Promise<{ data: unknown; error: unknown; sha256?: string; byteCount?: number }>;
}
export function feedError(error: unknown): SocialError {
  if (error instanceof SocialError) return error;
  const row = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const message = String(row.message ?? row.error ?? error ?? '');
  const known: [string, SocialError['code'], string][] = [
    ['shared_consent_changed', 'consent_changed', 'Automatic sharing changed. This flight stays private unless you share it again.'],
    ['shared_publication_changed', 'publication_changed', 'This flight’s sharing changed. Refresh before sharing it again.'],
    ['shared_flight_not_ready', 'flight_not_ready', 'Waiting for this flight’s finished summary to back up.'],
    ['shared_profile_required', 'profile_required', 'Choose your Friends display name before sharing flights.'],
    ['shared_account_deleting', 'account_deleting', 'Account deletion is in progress. Flight sharing is unavailable.'],
    ['shared_upload_busy', 'busy', 'A previous route upload is still finishing. Sharing will retry.'],
    ['shared_artifact_invalid', 'invalid_input', 'This route could not be shared. Your private flight remains saved.'],
  ];
  for (const [match, code, explanation] of known) if (message.includes(match) || row.code === match) return new SocialError(code, explanation);
  if (row.code === 'PGRST202' || row.code === '42883') return new SocialError('unavailable', 'The flight feed is not available on this server yet. Try again later.');
  if (row.code === '42501' || row.status === 403 || row.status === 404) return new SocialError('unavailable', 'This shared flight is no longer available. Refresh Friends.');
  return new SocialError('request_failed', 'Could not reach shared flights. Check your connection and try again.');
}
export function createFeedService(transport: FeedTransport): FeedService {
  async function run<T>(signal: AbortSignal, operation: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 60_000);
    try {
      if (signal.aborted) throw new SocialError('stale', 'Your account or connection changed. Try again.');
      const result = await operation(controller.signal);
      if (signal.aborted) throw new SocialError('stale', 'Your account or connection changed. Try again.');
      if (controller.signal.aborted) throw new SocialError('request_failed', 'Shared flights took too long to respond. Try again.');
      return result;
    } catch (error) { throw feedError(error); }
    finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
  }
  const rpc = (request: FeedRpcRequest, signal: AbortSignal) => run(signal, async inner => {
    const result = await transport.rpc(request, inner); if (result.error) throw result.error; return result.data;
  });
  return {
    getPreferences: async signal => parseSharingPreferences(await rpc({ name: 'social_get_sharing_preferences' }, signal)),
    setAutoShare: async (enabled, signal) => {
      const preferences = parseSharingPreferences(await rpc({ name: 'social_set_auto_share', args: { p_enabled: enabled } }, signal));
      if (!enabled && !signal.aborted) void transport.edge({ action: 'cleanup' }, signal).catch(() => undefined);
      return preferences;
    },
    getFeed: async (cursor, signal) => {
      if (cursor) { assertSocialUserId(cursor.activityId); if (!Number.isFinite(Date.parse(cursor.publishedAt))) throw new SocialError('invalid_input', 'Refresh the feed to continue.'); }
      return parseFeedPage(await rpc({ name: 'social_list_feed', args: { p_cursor_published_at: cursor?.publishedAt ?? null, p_cursor_activity_id: cursor?.activityId ?? null, p_limit: 25 } }, signal));
    },
    getDetail: async (activityId, signal) => {
      assertSocialUserId(activityId);
      const result = parseSharedFlight(await rpc({ name: 'social_get_activity', args: { p_activity_id: activityId } }, signal));
      if (result.activityId !== activityId) throw new SocialError('invalid_response', 'This shared flight changed. Refresh Friends.');
      return result;
    },
    getReplay: async (activityId, manifest, signal) => {
      assertSocialUserId(activityId); parseManifest(manifest);
      return run(signal, async inner => {
        const result = await transport.edge({ action: 'read', activityId, generation: manifest.generation }, inner);
        if (result.error) throw result.error;
        if (result.sha256 !== manifest.sha256 || result.byteCount !== manifest.byteCount) throw new SocialError('invalid_response', 'The shared route changed or could not be verified. Reopen this flight.');
        return parseSharedReplay(result.data);
      });
    },
    getPublication: async (flightId, signal) => {
      assertSocialUserId(flightId);
      const result = parsePublication(await rpc({ name: 'social_get_my_publication', args: { p_flight_id: flightId } }, signal));
      if (result.flightId !== flightId) throw new SocialError('invalid_response', 'Refresh this flight’s sharing status.');
      return result;
    },
    prepareShare: async (input, signal) => {
      assertSocialUserId(input.flightId); assertSocialUserId(input.operationId);
      if (input.consentGeneration !== null) assertSocialUserId(input.consentGeneration);
      if (!['automatic', 'manual'].includes(input.mode) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new SocialError('invalid_input', 'Refresh this flight before sharing.');
      return parsePreparedShare(await rpc({ name: 'social_prepare_share', args: { p_flight_id: input.flightId, p_operation_id: input.operationId,
        p_mode: input.mode, p_consent_generation: input.consentGeneration, p_expected_revision: input.expectedRevision } }, signal));
    },
    uploadShare: async (prepared: PreparedShare, artifact: SharedReplayArtifactV1, signal) => {
      assertSocialUserId(prepared.activityId); assertSocialUserId(prepared.uploadToken);
      const safe = parseSharedReplay(artifact);
      if (new TextEncoder().encode(JSON.stringify(safe)).byteLength > MAX_SHARED_ARTIFACT_BYTES) throw new SocialError('invalid_input', 'This route is too large to share. Your private flight remains saved.');
      return run(signal, async inner => {
        const result = await transport.edge({ action: 'upload', activityId: prepared.activityId, uploadToken: prepared.uploadToken, artifact: safe }, inner);
        if (result.error) throw result.error;
        const publication = parsePublication(result.data);
        if (publication.activityId !== prepared.activityId) throw new SocialError('invalid_response', 'Refresh this flight’s sharing status.');
        return publication;
      });
    },
    hideFlight: async (flightId, signal) => {
      assertSocialUserId(flightId);
      const result = parsePublication(await rpc({ name: 'social_hide_flight', args: { p_flight_id: flightId } }, signal));
      if (result.flightId !== flightId || result.state !== 'hidden') throw new SocialError('invalid_response', 'Hiding this flight could not be confirmed. Try again.');
      if (!signal.aborted) void transport.edge({ action: 'cleanup' }, signal).catch(() => undefined);
      return result;
    },
  };
}
