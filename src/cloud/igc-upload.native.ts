import { File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { parseArchivedIgc } from '@/archives/igc';
import { ARCHIVE_FREE_SPACE_RESERVE, MAX_ARCHIVE_IGC_BYTES, type ArchiveDownloadCandidate, type ArchiveRemoteFlight } from '@/archives/types';
import { CLOUD_CONFIG, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config';
import { existingIgcManifest } from './igc-manifest';
import { getSupabase } from './supabase';

type Guard = () => void;
const recoveryError = () => new Error('The existing track backup needs recovery. Its original file was not replaced. Retry backup.');
function alreadyExists(error: unknown): boolean {
  const value = error as { status?: number; statusCode?: string | number; error?: string; code?: string; message?: string };
  return Number(value.status ?? value.statusCode) === 409 ||
    /^(Duplicate|ResourceAlreadyExists|KeyAlreadyExists)$/.test(value.error ?? value.code ?? '') ||
    /already exists/i.test(value.message ?? '');
}

/** An interrupted upload has no known size yet; bound the native transfer before reading it into JS. */
async function recoverOriginal(row: ArchiveRemoteFlight, owner: string, token: string, guard: Guard): Promise<Uint8Array> {
  guard();
  if (Paths.availableDiskSpace < ARCHIVE_FREE_SPACE_RESERVE + MAX_ARCHIVE_IGC_BYTES * 3) {
    throw new Error('Free up space on this phone, then retry track backup recovery.');
  }
  const file = new File(Paths.cache, `recover-upload-${owner}-${row.id}.part`);
  const controller = new AbortController();
  try {
    await File.downloadFileAsync(`${SUPABASE_URL}/storage/v1/object/authenticated/${CLOUD_CONFIG.igcBucket}/${owner}/${row.id}.igc`, file, {
      idempotent: true, signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_PUBLISHABLE_KEY },
      onProgress: ({ bytesWritten }) => {
        try { guard(); if (bytesWritten > MAX_ARCHIVE_IGC_BYTES) throw recoveryError(); }
        catch { controller.abort(); }
      },
    });
    guard();
    if (controller.signal.aborted || file.size <= 0 || file.size > MAX_ARCHIVE_IGC_BYTES) throw recoveryError();
    const bytes = await file.bytes();
    guard();
    if (bytes.byteLength !== file.size) throw recoveryError();
    parseArchivedIgc(bytes, { startedAt: row.started_at, endedAt: row.ended_at ?? row.started_at });
    return bytes;
  } finally {
    if (file.exists) file.delete();
  }
}

/** The first object wins. A missing database receipt never authorizes replacing its bytes. */
export async function publishFirstIgc(
  row: ArchiveRemoteFlight,
  owner: string,
  artifact: { content: string; artifactVersion: number },
  guard: Guard,
): Promise<ArchiveDownloadCandidate> {
  guard();
  if (row.user_id !== owner || existingIgcManifest(row, owner)) throw recoveryError();
  let byteCount = new TextEncoder().encode(artifact.content).byteLength;
  if (byteCount <= 0 || byteCount > MAX_ARCHIVE_IGC_BYTES) throw new Error('The track backup exceeds the supported file size.');
  let sha256 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, artifact.content);
  let artifactVersion = artifact.artifactVersion;
  guard();
  const client = getSupabase();
  const session = await client.auth.getSession();
  guard();
  if (session.error) throw session.error;
  if (session.data.session?.user.id !== owner) throw new Error('The backup account changed. Retry after signing in.');
  const authorization = `Bearer ${session.data.session.access_token}`;
  const objectPath = `${owner}/${row.id}.igc`;
  const upload = await client.storage.from(CLOUD_CONFIG.igcBucket).upload(objectPath, artifact.content, {
    contentType: 'application/vnd.fai.igc', upsert: false, headers: { Authorization: authorization },
  });
  guard();
  if (upload.error) {
    if (!alreadyExists(upload.error)) throw upload.error;
    const bytes = await recoverOriginal(row, owner, session.data.session.access_token, guard);
    const recoveredHash = Array.from(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new Uint8Array(bytes))))
      .map(value => value.toString(16).padStart(2, '0')).join('');
    guard();
    // Older unsigned artifacts use the same archived IGC parser. Do not label unknown original bytes as newly generated.
    if (recoveredHash !== sha256) artifactVersion = 1;
    sha256 = recoveredHash;
    byteCount = bytes.byteLength;
  }
  guard();
  const update = await client.from('flights').update({ igc_object_path: objectPath, igc_sha256: sha256,
    igc_byte_count: byteCount, igc_artifact_version: artifactVersion })
    .eq('id', row.id).eq('user_id', owner)
    .is('igc_object_path', null).is('igc_sha256', null).is('igc_byte_count', null).is('igc_artifact_version', null)
    .setHeader('Authorization', authorization).select('*').maybeSingle();
  guard();
  if (update.error) throw update.error;
  let canonical = update.data;
  if (!canonical) {
    const readback = await client.from('flights').select('*').eq('id', row.id).eq('user_id', owner)
      .setHeader('Authorization', authorization).single();
    guard();
    if (readback.error) throw readback.error;
    canonical = readback.data;
  }
  const manifest = canonical && existingIgcManifest(canonical, owner);
  if (!manifest || manifest.sha256.toLowerCase() !== sha256.toLowerCase() || manifest.byteCount !== byteCount) throw recoveryError();
  return manifest;
}
