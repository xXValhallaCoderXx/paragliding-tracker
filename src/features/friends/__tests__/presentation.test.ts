import { friendInitials, REQUEST_STATUS, relationshipActions, validDisplayName, validUsername } from '../presentation';

it('previews chosen initials without inventing a name and handles Unicode code points', () => {
  expect(friendInitials('')).toBe('');
  expect(friendInitials('  Amélie  Mei  Wong ')).toBe('AW');
  expect(friendInitials('陈')).toBe('陈');
  expect(friendInitials('🪂 Pilot')).toBe('🪂P');
  expect(validDisplayName('   ')).toBe(false);
  expect(validDisplayName('🪂'.repeat(60))).toBe(true);
  expect(validDisplayName('a'.repeat(61))).toBe(false);
  expect(validUsername('pilot_123')).toBe(true);
  for (const value of ['ab', 'a'.repeat(25), 'Ada', '@ada', 'ada wong', '陈陈陈']) expect(validUsername(value)).toBe(false);
});

it('explains unsuccessful requests and only exposes valid relationship actions', () => {
  expect(REQUEST_STATUS.unavailable.success).toBe(false);
  expect(REQUEST_STATUS.rate_limited.success).toBe(false);
  expect(REQUEST_STATUS.incoming.message).toContain('Accept');
  expect(relationshipActions('incoming').map(item => item.action)).toEqual(['accept', 'decline', 'block']);
  expect(relationshipActions('outgoing').map(item => item.action)).toEqual(['cancel', 'block']);
  expect(relationshipActions('accepted').map(item => item.action)).toEqual(['remove', 'block']);
  expect(relationshipActions('blocked').map(item => item.action)).toEqual(['unblock']);
});
