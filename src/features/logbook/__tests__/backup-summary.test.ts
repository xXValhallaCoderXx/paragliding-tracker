import { backupSummary, LOCAL_FLIGHTS_COPY } from '../backup-summary';

describe('optional backup without a fictional flight limit', () => {
  it('does not equate authentication with successful upload', () => {
    expect(backupSummary('signed_in', 'pilot').detail).toContain('Check sync status');
    expect(backupSummary('signed_in', 'pilot').headline).toBe('Backup status');
  });
  it('explains unavailable cloud without restricting local recording', () => {
    expect(backupSummary('unconfigured', null).detail).toContain(LOCAL_FLIGHTS_COPY);
    expect(backupSummary('unconfigured', null).detail).toContain('not configured');
  });
});
