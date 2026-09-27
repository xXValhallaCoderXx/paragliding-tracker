import React from 'react';
import { BackHandler, KeyboardAvoidingView, ScrollView, Text } from 'react-native';
import { Button, Input, LinkButton, ListRow, TopBar } from '@/components/ui';
import type { AuthSnapshot, SyncSnapshot } from '@/cloud/types';
import SignInScreen from '../sign-in-screen';
import FriendsScreen from '@/features/friends/friends-screen';
import { feedContext, friendsContext } from '@/features/feed/__tests__/fixtures';
import { act, create } from '../../../../tests/support/renderer';

let mockAuth: AuthSnapshot;
let mockFocused = true;
let mockSync: SyncSnapshot;
let mockFriends = friendsContext();
const mockFeed = feedContext();
const mockRequest = jest.fn(); const mockVerify = jest.fn();
const mockSyncNow = jest.fn(); const mockRebind = jest.fn();
const mockRouter = { dismissTo: jest.fn(), push: jest.fn() };
jest.mock('../auth-provider', () => ({ useCloudAuth: () => ({ ...mockAuth, requestOtp: mockRequest, verifyOtp: mockVerify }) }));
jest.mock('../cloud-sync-provider', () => ({ useCloudSync: () => ({ ...mockSync, requestSync: mockSyncNow, rebindToCurrentAccount: mockRebind }) }));
jest.mock('@/features/friends/friends-provider', () => ({ useFriends: () => mockFriends }));
jest.mock('@/features/feed/feed-provider', () => ({ useFeed: () => mockFeed }));
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest hoists factories.
  useFocusEffect: (effect: () => void) => require('react').useEffect(() => mockFocused ? effect() : undefined, [effect, mockFocused]),
}));
jest.mock('@/components/ui/journal-art', () => ({ JournalArt: () => null }));
jest.mock('@/components/ui', () => Object.fromEntries([
  'Avatar', 'BusyRow', 'Button', 'Card', 'Disclaimer', 'Input', 'LinkButton', 'ListRow', 'Notice', 'Screen', 'SectionLabel', 'TopBar',
].map(name => [name, ({ children }: { children?: React.ReactNode }) => children ?? null])));
let rendered: ReturnType<typeof create>;
const input = () => rendered.root.findByType(Input);
const control = (label: string) => [...rendered.root.findAllByType(Button), ...rendered.root.findAllByType(LinkButton)]
  .find((node: any) => node.props.label === label)!;
async function run(fn: () => unknown) { await act(async () => { await fn(); }); }
async function mount() { await run(() => { rendered = create(React.createElement(SignInScreen)); }); }
async function update() { await run(() => rendered.update(React.createElement(SignInScreen))); }
async function press(label: string) { await run(() => control(label).props.onPress()); }
function deferred() { let resolve!: () => void; let reject!: (e: Error) => void; const promise = new Promise<void>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
beforeEach(() => {
  jest.clearAllMocks(); mockFocused = true;
  mockAuth = { status: 'signed_out', userId: null, email: null, lastError: null };
  mockSync = { phase: 'idle', blockedBy: null, pendingFlights: 2, pendingDeletions: 1, cloudOnlyFlights: 0, lastSyncAt: null, linkedUserId: null, lastError: null };
  mockFriends = friendsContext({ profile: null });
  mockRequest.mockReset().mockResolvedValue(undefined); mockVerify.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => { await run(() => rendered?.unmount()); jest.restoreAllMocks(); });

it('provides keyboard avoidance and an accessible scrollable form', async () => {
  await mount();
  expect(rendered.root.findByType(KeyboardAvoidingView).props.behavior).toBe('padding'); // jest-expo runs as iOS.
  expect(rendered.root.findByType(ScrollView).props.keyboardShouldPersistTaps).toBe('handled');
  expect(input().props.label).toBe('Email'); expect(rendered.root.findByType(TopBar).props.backLabel).toBe('Back to Pilot');
});

it.each(['Back', 'Not now', 'Android Back'])('allows %s during a request, returns to Pilot, and ignores late failure', async (exit) => {
  const listener = jest.spyOn(BackHandler, 'addEventListener');
  const pending = deferred(); mockRequest.mockReturnValue(pending.promise);
  await mount(); await run(() => input().props.onChangeText('qa@example.test')); await press('Email me a code');
  if (exit === 'Back') await run(() => rendered.root.findByType(TopBar).props.onBack());
  else if (exit === 'Not now') await press('Not now');
  else await run(() => listener.mock.calls[0][1]({ type: 'hardwareBackPress', timeStamp: 0 }));
  expect(mockRouter.dismissTo).toHaveBeenCalledWith('/account'); expect(rendered.root.findAllByType(Input)).toHaveLength(0);
  await run(() => pending.reject(new Error('Obsolete error')));
  await run(() => rendered.unmount()); await mount();
  expect(input().props).toMatchObject({ value: '', error: null }); expect(mockRouter.dismissTo).toHaveBeenCalledTimes(1);
});

it('discards draft on navigation blur, including a late successful verification, without navigating', async () => {
  const pending = deferred(); mockVerify.mockReturnValue(pending.promise);
  await mount(); await run(() => input().props.onChangeText('qa@example.test')); await press('Email me a code');
  await run(() => input().props.onChangeText('12345678')); await press('Continue');
  mockFocused = false; await update();
  await run(() => { mockAuth = { ...mockAuth, status: 'signed_in', email: 'qa@example.test', userId: 'qa' }; pending.resolve(); });
  expect(mockRouter.dismissTo).not.toHaveBeenCalled(); expect(rendered.root.findAllByType(Input)).toHaveLength(0);
  mockFocused = true; await update(); expect(control('Open Home')).toBeDefined(); expect(mockRouter.dismissTo).not.toHaveBeenCalled();
});

it('starts a fresh form after blur/re-entry while retaining mounted input during ordinary rerenders', async () => {
  await mount(); await run(() => input().props.onChangeText('draft@example.test')); await update();
  expect(input().props.value).toBe('draft@example.test');
  mockFocused = false; await update(); mockFocused = true; await update();
  expect(input().props.value).toBe('');
});

it.each([
  [{ phase: 'idle' }, 'Never', '2 flight changes and 1 deletion'],
  [{ phase: 'syncing' }, 'Backing up…', '2 flight changes'],
  [{ phase: 'error', lastError: 'No connection' }, 'Could not back up', 'No connection'],
  [{ phase: 'blocked', blockedBy: 'recording' }, 'Paused', 'finished'],
  [{ phase: 'blocked', blockedBy: 'account_mismatch' }, 'Different account', 'linked to another account'],
] as const)('shows signed-in separately from backup state %j without sync or rebind writes', async (patch, label, detail) => {
  mockAuth = { ...mockAuth, status: 'signed_in', userId: 'qa', email: 'qa@example.test' }; mockSync = { ...mockSync, ...patch };
  await mount();
  expect(rendered.root.findAllByType(Text).some((n: any) => n.props.children === 'Signed in')).toBe(true);
  expect(rendered.root.findByType(ListRow).props).toMatchObject({ label: 'Backup', value: label, detail: expect.stringContaining(detail) });
  expect(mockSyncNow).not.toHaveBeenCalled(); expect(mockRebind).not.toHaveBeenCalled(); expect(mockRouter.dismissTo).not.toHaveBeenCalled();
  await press('View backup in Pilot'); expect(mockRouter.dismissTo).toHaveBeenCalledWith('/account');
});

it.each([false, true])('hands off to the explicit Friends flow and preserves existing profile/preferences: %s', async (existing) => {
  mockAuth = { ...mockAuth, status: 'signed_in', userId: 'qa' };
  if (existing) mockFriends = friendsContext({ profile: { userId: 'qa', displayName: 'Existing Name', username: 'qa_pilot', discoverable: false, backedUpFlightCount: 2 } });
  const previousProfile = mockFriends.profile; const previousPreferences = mockFeed.preferences;
  await mount(); expect(mockFriends.saveProfile).not.toHaveBeenCalled();
  await press('Set up Friends'); expect(mockRouter.dismissTo).toHaveBeenCalledWith('/friends');
  await run(() => rendered.update(React.createElement(FriendsScreen)));
  expect(mockFriends.saveProfile).not.toHaveBeenCalled(); expect(mockFeed.setAutoShare).not.toHaveBeenCalled();
  expect(mockFriends.profile).toBe(previousProfile); expect(mockFeed.preferences).toBe(previousPreferences);
  if (!existing) {
    const name = rendered.root.findAllByType(Input).find((n: any) => n.props.label === 'Display name');
    expect(name.props.value).toBe(''); expect(control('Create my Friends profile').props.disabled).toBe(true);
  }
});
