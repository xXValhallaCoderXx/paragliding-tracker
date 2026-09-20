import { catalogueContinuation, restorePauseReason, type RestoreEnvironment } from '../restore-plan';

const ready: RestoreEnvironment = { foreground: true, recorderReady: true, recorderBusy: false, network: 'wifi' };
it('downloads automatically on Wi-Fi and requires deliberate mobile consent', () => {
  expect(restorePauseReason(ready, true, false, false)).toBeNull();
  expect(restorePauseReason({ ...ready, network: 'other' }, true, false, false)).toBe('wifi');
  expect(restorePauseReason({ ...ready, network: 'other' }, true, false, true)).toBeNull();
});
it.each(['offline', 'unknown'] as const)('does not interpret %s as permission to download', (network) => {
  expect(restorePauseReason({ ...ready, network }, true, false, true)).toBe('offline');
});
it('preserves user pause and gives capture/recovery priority even with mobile consent', () => {
  expect(restorePauseReason(ready, true, true, true)).toBe('user');
  expect(restorePauseReason({ ...ready, recorderBusy: true }, true, false, true)).toBe('recording');
  expect(restorePauseReason({ ...ready, recorderReady: false }, true, false, true)).toBe('recovering');
  expect(restorePauseReason({ ...ready, foreground: false }, true, false, true)).toBe('background');
  expect(restorePauseReason(ready, false, false, true)).toBe('signed_out');
});
it('continues through identical timestamps using the flight id', () => {
  const updatedAt = '2026-09-20T12:00:00.123456+00:00';
  const id = '12345678-1234-1234-1234-123456789abc';
  expect(catalogueContinuation({ updatedAt, id })).toBe(`updated_at.gt.${updatedAt},and(updated_at.eq.${updatedAt},id.gt.${id})`);
  expect(() => catalogueContinuation({ updatedAt, id: '),user_id.neq.x' })).toThrow('Invalid saved archive cursor');
});
