import type { CloudAuthStatus } from '@/cloud/types';

export const LOCAL_FLIGHTS_COPY = 'Recording stays available without an account. Saved flights are never automatically removed.';

export function backupSummary(status: CloudAuthStatus, linkedUserId: string | null) {
  return {
    headline: status === 'signed_in' ? 'Backup status' : 'Saved on this phone',
    detail: status === 'unconfigured'
      ? `${LOCAL_FLIGHTS_COPY} Cloud backup is not configured in this build.`
      : status === 'signed_in'
        ? 'Signing in enables backup. Check sync status below to see what has uploaded.'
        : `${LOCAL_FLIGHTS_COPY} ${linkedUserId ? 'Sign back in to continue backup.' : 'An optional account can keep a second copy of eligible summaries and IGC files.'}`,
  };
}
