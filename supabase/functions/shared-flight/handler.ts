import { ArtifactError, digest, MAX_ARTIFACT_BYTES, routePreview, validateArtifact } from './validator.ts';

interface ServiceError { message: string; code?: string }
export interface SharedFlightAdmin {
  auth: { getUser(token: string): Promise<{ data: { user: { id: string } | null }; error: ServiceError | null }> };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: ServiceError | null }>;
  storage: { from(bucket: string): {
    upload(path: string, bytes: Uint8Array, options: { contentType: string; upsert: boolean }): Promise<{ error: ServiceError | null }>;
    download(path: string): Promise<{ data: Blob | null; error: ServiceError | null }>;
    remove(paths: string[]): Promise<{ error: ServiceError | null }>;
  } };
}
const BUCKET = 'shared-flight-replays';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const knownErrors = new Set(['shared_consent_changed', 'shared_publication_changed', 'shared_flight_not_ready',
  'shared_profile_required', 'shared_account_deleting', 'shared_upload_busy', 'shared_artifact_invalid']);
function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ArtifactError();
  return value as Record<string, unknown>;
}
async function rpc(admin: SharedFlightAdmin, name: string, args: Record<string, unknown>) {
  const result = await admin.rpc(name, args);
  if (result.error) throw result.error;
  return result.data;
}
/** Retryable durable work; only paths returned by the service-only SQL query. */
export async function cleanupArtifacts(admin: SharedFlightAdmin): Promise<void> {
  const items = await rpc(admin, 'social_list_artifact_cleanup', { p_limit: 25 });
  if (!Array.isArray(items)) return;
  for (const item of items) {
    const entry = record(item);
    if (typeof entry.objectPath !== 'string' || typeof entry.ownerId !== 'string' || !UUID.test(entry.ownerId) ||
        !entry.objectPath.startsWith(`${entry.ownerId}/`) || entry.objectPath.slice(entry.ownerId.length + 1).includes('/')) continue;
    const { error } = await admin.storage.from(BUCKET).remove([entry.objectPath]);
    await rpc(admin, 'social_ack_artifact_cleanup', { p_object_path: entry.objectPath, p_removed: !error });
  }
}
async function body(request: Request): Promise<Record<string, unknown>> {
  // Enforce the actual streamed length too: Content-Length may be absent or false.
  if (Number(request.headers.get('Content-Length') ?? 0) > MAX_ARTIFACT_BYTES + 1024) throw new ArtifactError();
  const reader = request.body?.getReader();
  if (!reader) throw new ArtifactError();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > MAX_ARTIFACT_BYTES + 1024) { await reader.cancel(); throw new ArtifactError(); }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch (error) { if (error instanceof ArtifactError) throw error; throw new ArtifactError(); }
}
export function createSharedFlightHandler(dependencies: {
  env(name: string): string | undefined;
  createAdmin(url: string, key: string): SharedFlightAdmin;
}) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return response({ error: 'method_not_allowed' }, 405);
    const token = request.headers.get('Authorization')?.match(/^Bearer\s+(\S+)\s*$/i)?.[1];
    if (!token) return response({ error: 'unauthorized' }, 401);
    const url = dependencies.env('SUPABASE_URL');
    const secret = dependencies.env('SHARED_FLIGHT_SECRET_KEY') ?? dependencies.env('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !secret) return response({ error: 'shared_unavailable' }, 503);
    const admin = dependencies.createAdmin(url, secret);
    let upload: { owner: string; activity: string; token: string } | null = null;
    try {
      const { data: { user }, error } = await admin.auth.getUser(token);
      if (error || !user) return response({ error: 'unauthorized' }, 401);
      const input = await body(request);
      if (input.action === 'cleanup' && Object.keys(input).length === 1) {
        await cleanupArtifacts(admin);
        return response({ cleaned: true });
      }
      if (typeof input.activityId !== 'string' || !UUID.test(input.activityId)) throw new ArtifactError();
      if (input.action === 'read') {
        if (Object.keys(input).length !== 3 || typeof input.generation !== 'string' || !UUID.test(input.generation)) throw new ArtifactError();
        const args = { p_caller: user.id, p_activity_id: input.activityId, p_generation: input.generation };
        const manifest = record(await rpc(admin, 'social_authorize_artifact', args));
        const { data, error } = await admin.storage.from(BUCKET).download(String(manifest.objectPath));
        if (error || !data || data.size > MAX_ARTIFACT_BYTES || data.size !== manifest.byteCount) throw new Error('shared_artifact_invalid');
        const bytes = new Uint8Array(await data.arrayBuffer());
        if (await digest(bytes) !== manifest.sha256) throw new ArtifactError();
        validateArtifact(JSON.parse(new TextDecoder().decode(bytes)));
        // Download may have waited while the owner hid/deleted this publication.
        const fresh = record(await rpc(admin, 'social_authorize_artifact', args));
        if (fresh.objectPath !== manifest.objectPath || fresh.sha256 !== manifest.sha256) throw { code: '42501' };
        return new Response(bytes, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
      }
      if (input.action !== 'upload' || Object.keys(input).length !== 4 || typeof input.uploadToken !== 'string' || !UUID.test(input.uploadToken)) throw new ArtifactError();
      // Cheap strict validation precedes any reservation or object mutation.
      const artifact = validateArtifact(input.artifact);
      const bytes = new TextEncoder().encode(JSON.stringify(artifact));
      if (bytes.length > MAX_ARTIFACT_BYTES) throw new ArtifactError();
      const args = { p_owner: user.id, p_activity_id: input.activityId, p_upload_token: input.uploadToken };
      const reservation = record(await rpc(admin, 'social_begin_upload', args));
      if (reservation.alreadyPublished === true) return response(reservation.publication);
      upload = { owner: user.id, activity: input.activityId, token: input.uploadToken };
      validateArtifact(artifact, { startedAt: Number(reservation.startedAt), endedAt: Number(reservation.endedAt), partial: reservation.partial === true });
      const sha256 = await digest(bytes);
      const path = String(reservation.objectPath);
      const { error: uploadError } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: 'application/json', upsert: false });
      if (uploadError) {
        // A lost response may leave the immutable object present. Reuse only the
        // exact verified bytes; never overwrite a prior operation's artifact.
        const existing = await admin.storage.from(BUCKET).download(path);
        if (existing.error || !existing.data || existing.data.size !== bytes.length ||
            await digest(new Uint8Array(await existing.data.arrayBuffer())) !== sha256) throw uploadError;
      }
      const result = await rpc(admin, 'social_activate_upload', { ...args, p_sha256: sha256, p_byte_count: bytes.length,
        p_provenance: artifact.provenance, p_replay_available: artifact.points.length >= 2,
        p_route_preview: routePreview(artifact.points) });
      upload = null;
      await cleanupArtifacts(admin).catch(() => undefined);
      return response(result);
    } catch (error) {
      if (upload) {
        await rpc(admin, 'social_finish_failed_upload', { p_owner: upload.owner, p_activity_id: upload.activity, p_upload_token: upload.token }).catch(() => undefined);
        await cleanupArtifacts(admin).catch(() => undefined);
      }
      const detail = error && typeof error === 'object' ? error as { message?: string; code?: string } : {};
      if (detail.code === '42501') return response({ error: 'shared_unavailable' }, 403);
      if (detail.message && knownErrors.has(detail.message)) return response({ error: detail.message }, detail.message === 'shared_artifact_invalid' ? 400 : 409);
      return response({ error: 'shared_unavailable' }, 503);
    }
  };
}
