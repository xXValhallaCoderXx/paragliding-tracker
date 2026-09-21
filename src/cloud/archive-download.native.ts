import { File, Paths } from 'expo-file-system';
import { ARCHIVE_FREE_SPACE_RESERVE, MAX_ARCHIVE_IGC_BYTES, type ArchiveDownloadCandidate } from '@/archives/types';
import { getSupabase } from './supabase';
import { CLOUD_CONFIG, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config';

export async function downloadArchiveIgc(candidate: ArchiveDownloadCandidate, signal: AbortSignal, progress: (bytes: number) => void): Promise<Uint8Array> {
  if (candidate.objectPath !== `${candidate.ownerUserId}/${candidate.flightId}.igc` ||
      !Number.isSafeInteger(candidate.byteCount) || candidate.byteCount <= 0 || candidate.byteCount > MAX_ARCHIVE_IGC_BYTES) {
    throw new Error('The backed-up track has an invalid file reference.');
  }
  // Reserve space for SQLite's durable copy and temporary transfer/WAL, as well as capture.
  if (Paths.availableDiskSpace < ARCHIVE_FREE_SPACE_RESERVE + candidate.byteCount * 3) {
    throw Object.assign(new Error('Free up space on this phone, then retry restoration.'), { code: 'archive_storage' });
  }
  const { data, error } = await getSupabase().auth.getSession();
  if (error) throw error;
  if (data.session?.user.id !== candidate.ownerUserId || signal.aborted) throw new Error('Archive download was cancelled.');
  const temporary = new File(Paths.cache, `restore-${candidate.ownerUserId}-${candidate.flightId}.part`);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort);
  let oversized = false;
  try {
    const url = `${SUPABASE_URL}/storage/v1/object/authenticated/${CLOUD_CONFIG.igcBucket}/${candidate.objectPath}`;
    await File.downloadFileAsync(url, temporary, {
      idempotent: true, signal: controller.signal,
      headers: { Authorization: `Bearer ${data.session.access_token}`, apikey: SUPABASE_PUBLISHABLE_KEY },
      onProgress: ({ bytesWritten }) => {
        if (bytesWritten > candidate.byteCount || bytesWritten > MAX_ARCHIVE_IGC_BYTES) { oversized = true; controller.abort(); }
        else progress(bytesWritten);
      },
    });
    if (signal.aborted) throw new Error('Archive download was cancelled.');
    if (temporary.size !== candidate.byteCount) throw new Error('The downloaded track is incomplete. Retry to refresh its backup.');
    return await temporary.bytes();
  } catch (error) {
    if (oversized) throw new Error('The downloaded track does not match its saved size. Retry to refresh its backup.');
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
    if (temporary.exists) temporary.delete();
  }
}
