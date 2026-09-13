import React from 'react';
import { Alert } from 'react-native';

import AccountScreen from '@/app/(tabs)/account';
import type { AuthSnapshot, SyncSnapshot } from '@/cloud/types';
import { Button, Input, ListRow, Notice } from '@/components/ui';
import { AccountCard, RestoringAccountCard } from '../components/account-card';
import { IdentityCard } from '../components/identity-card';
import { SignInCard } from '../components/sign-in-card';
import { create, act } from '../../../../tests/support/renderer';
import { flight, profile } from '../../../../tests/support/fixtures';

let mockAuth: AuthSnapshot;
const mockSignOut = jest.fn();
const mockRequestOtp = jest.fn();
const mockVerifyOtp = jest.fn();
const mockProfile = profile({ pilotName: 'Local pilot' });
const mockFlights = [flight()];
const mockSync: SyncSnapshot = {
  phase: 'blocked', blockedBy: 'signed_out', lastSyncAt: null,
  pendingFlights: 1, pendingDeletions: 0, cloudOnlyFlights: 0,
  linkedUserId: 'previous-account', lastError: null,
};

jest.mock('../auth-provider', () => ({
  useCloudAuth: () => ({
    ...mockAuth, signOut: mockSignOut, requestOtp: mockRequestOtp,
    verifyOtp: mockVerifyOtp, deleteAccount: jest.fn(),
  }),
}));
jest.mock('../cloud-sync-provider', () => ({
  useCloudSync: () => ({ ...mockSync, requestSync: jest.fn() }),
}));
jest.mock('@/features/record/recorder-lifecycle', () => ({
  useRecorderLifecycle: () => ({ ready: true }),
}));
jest.mock('@/store/endpoints', () => ({
  useGetProfileQuery: () => ({ data: mockProfile, isLoading: false }),
  useGetFlightsQuery: () => ({ data: mockFlights }),
  useUpdateProfileMutation: () => [jest.fn(), { isLoading: false }],
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest factories are hoisted.
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, [effect]),
}));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('@/components/ui/journal-art', () => ({ JournalArt: () => null }));
jest.mock('../components/identity-card', () => ({ IdentityCard: () => null }));
jest.mock('../components/pilot-details-sheet', () => ({ PilotDetailsSheet: () => null }));
jest.mock('@/components/ui', () => Object.fromEntries([
  'BusyRow', 'Button', 'Card', 'Disclaimer', 'Input', 'LinkButton', 'ListRow',
  'Notice', 'Screen', 'SectionLabel',
].map((name) => [name, ({ children }: { children?: React.ReactNode }) => children ?? null])));

type TestNode = { props: Record<string, any> };
let rendered: {
  root: { findByType: (type: unknown) => TestNode; findAllByType: (type: unknown) => TestNode[] };
  update: (element: React.ReactElement) => void;
  unmount: () => void;
};
const button = (label: string) => rendered.root.findAllByType(Button)
  .find((node) => node.props.label === label);
async function mount() {
  await act(async () => { rendered = create(React.createElement(AccountScreen)); });
}
async function updateAuth(patch: Partial<AuthSnapshot>) {
  mockAuth = { ...mockAuth, ...patch };
  await act(async () => rendered.update(React.createElement(AccountScreen)));
}
async function press(callback: () => void) { await act(async () => callback()); }

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockAuth = { status: 'signed_out', userId: null, email: null, lastError: null };
  mockSignOut.mockReset().mockResolvedValue(undefined);
  mockRequestOtp.mockResolvedValue(undefined);
  mockVerifyOtp.mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(async () => {
  if (rendered) await act(async () => rendered.unmount());
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('waits for session restoration before offering sign-in or logout', async () => {
  mockAuth.status = 'restoring';
  await mount();
  expect(rendered.root.findAllByType(RestoringAccountCard)).toHaveLength(1);
  expect(rendered.root.findAllByType(SignInCard)).toHaveLength(0);
  expect(button('Log out')).toBeUndefined();

  await updateAuth({ status: 'signed_in', userId: 'pilot', email: 'pilot@example.com' });
  expect(rendered.root.findByType(AccountCard).props.email).toBe('pilot@example.com');
  expect(button('Log out')).toBeDefined();
  expect(rendered.root.findAllByType(SignInCard)).toHaveLength(0);
  expect(rendered.root.findAllByType(ListRow).some((row) => row.props.value === 'Signed in')).toBe(true);
});

it('keeps email entry behind Sign in when a local profile and previous backup have no session', async () => {
  await mount();
  expect(rendered.root.findByType(IdentityCard).props.profile).toBe(mockProfile);
  expect(rendered.root.findAllByType(AccountCard)).toHaveLength(0);
  expect(button('Log out')).toBeUndefined();
  expect(rendered.root.findAllByType(Input)).toHaveLength(0);

  await press(() => button('Sign in')!.props.onPress());
  const emailInput = rendered.root.findByType(Input);
  await press(() => emailInput.props.onChangeText('pilot@example.com'));
  await press(() => button('Email me a code')!.props.onPress());
  expect(mockRequestOtp).toHaveBeenCalledWith('pilot@example.com');
  await press(() => rendered.root.findByType(Input).props.onChangeText('12345678'));
  expect(mockVerifyOtp).toHaveBeenCalledWith('pilot@example.com', '12345678');

  await updateAuth({ status: 'signed_in', userId: 'pilot', email: 'pilot@example.com' });
  expect(rendered.root.findAllByType(Input)).toHaveLength(0);
  expect(button('Log out')).toBeDefined();
});

it('keeps sign-in recovery errors visible before opening the email form', async () => {
  mockAuth.lastError = { code: 'auth_error', message: 'Sign in again to continue.', occurredAt: 1 };
  await mount();
  expect(rendered.root.findAllByType(Notice).some((notice) =>
    notice.props.children === 'Sign in again to continue.')).toBe(true);
  expect(button('Sign in')).toBeDefined();
  expect(rendered.root.findAllByType(Input)).toHaveLength(0);
});

it('confirms logout, disables it while pending and retains the local pilot page afterwards', async () => {
  mockAuth = { ...mockAuth, status: 'signed_in', userId: 'pilot', email: 'pilot@example.com' };
  let completeLogout!: () => void;
  mockSignOut.mockImplementation(() => new Promise<void>((resolve) => { completeLogout = resolve; }));
  await mount();
  await press(() => button('Log out')!.props.onPress());
  expect(mockSignOut).not.toHaveBeenCalled();
  const [title, message, actions] = jest.mocked(Alert.alert).mock.calls[0];
  expect(title).toBe('Log out?');
  expect(message).toContain('Your flights stay on this phone.');
  expect(actions?.find((action) => action.text === 'Cancel')?.style).toBe('cancel');
  await press(() => actions?.find((action) => action.text === 'Log out')?.onPress?.());
  expect(mockSignOut).toHaveBeenCalledTimes(1);
  expect(button('Logging out…')?.props.disabled).toBe(true);
  await press(completeLogout);
  await updateAuth({ status: 'signed_out', userId: null, email: null });
  expect(button('Sign in')).toBeDefined();
  expect(rendered.root.findByType(IdentityCard).props.profile).toBe(mockProfile);
  expect(rendered.root.findByType(IdentityCard).props.stats.flightCount).toBe(1);
});

it.each(['signed_in', 'signed_out'] as const)(
  'keeps logout errors visible when the session remains %s',
  async (status) => {
    mockAuth = { ...mockAuth, status: 'signed_in', userId: 'pilot', email: 'pilot@example.com' };
    mockSignOut.mockImplementation(async () => {
      // The SDK can emit SIGNED_OUT before returning an error, or fail before removal.
      if (status === 'signed_out') {
        mockAuth = { ...mockAuth, status, userId: null, email: null };
      }
      mockAuth = {
        ...mockAuth,
        lastError: {
          code: 'offline', message: 'No connection. Try again when you have signal.', occurredAt: 1,
        },
      };
      throw new Error('No connection. Try again when you have signal.');
    });
    await mount();
    await press(() => button('Log out')!.props.onPress());
    const actions = jest.mocked(Alert.alert).mock.calls[0][2];
    await press(() => actions?.find((action) => action.text === 'Log out')?.onPress?.());

    expect(rendered.root.findAllByType(Notice).filter((notice) =>
      notice.props.children === 'No connection. Try again when you have signal.')).toHaveLength(1);
    expect(button('Logging out…')).toBeUndefined();
    if (status === 'signed_in') expect(button('Log out')?.props.disabled).toBe(false);
    else expect(button('Sign in')).toBeDefined();
    expect(rendered.root.findByType(IdentityCard).props.profile).toBe(mockProfile);
  },
);
