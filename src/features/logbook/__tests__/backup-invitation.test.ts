import { backupInvitation, backupSummary, LOCAL_FLIGHTS_COPY } from '../backup-invitation';

describe('optional backup without a fictional flight limit', () => {
  it.each(['signed_in', 'restoring', 'unconfigured'] as const)('does not invite while %s', (status) => {
    expect(backupInvitation(status, null)).toBeNull();
  });
  it('offers a second copy without asking the pilot to delete flights', () => {
    expect(backupInvitation('signed_out', null)).toMatchObject({ title: 'Keep a second copy', action: 'Explore backup' });
    expect(backupInvitation('signed_out', null)?.body).toContain(LOCAL_FLIGHTS_COPY);
  });
  it('offers reconnection to a previously linked account', () => {
    expect(backupInvitation('signed_out', 'pilot')?.action).toBe('Sign back in');
  });
  it('does not equate authentication with successful upload', () => {
    expect(backupSummary('signed_in', 'pilot').detail).toContain('Check sync status');
    expect(backupSummary('signed_in', 'pilot').headline).toBe('Backup status');
  });
  it('explains unavailable cloud without restricting local recording', () => {
    expect(backupSummary('unconfigured', null).detail).toContain(LOCAL_FLIGHTS_COPY);
    expect(backupSummary('unconfigured', null).detail).toContain('not configured');
  });
});
