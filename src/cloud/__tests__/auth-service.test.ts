import { AuthClient, AuthRetryableFetchError, type Session } from '@supabase/supabase-js';

import type { CloudAuthService } from '../types';

jest.mock('../config', () => ({
  ...jest.requireActual('../config'),
  cloudConfigured: true,
}));

let mockAuth: InstanceType<typeof AuthClient>;
jest.mock('../supabase', () => ({ getSupabase: () => ({ auth: mockAuth }) }));

const STORAGE_KEY = 'auth-service-test-session';
const syntheticSession = (): Session => ({
  access_token: 'synthetic-access-token',
  refresh_token: 'synthetic-refresh-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: {
    id: 'synthetic-user',
    email: 'pilot@example.test',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-01-01T00:00:00Z',
  },
});

let service: CloudAuthService;
let stored: Map<string, string>;
let unsubscribe: () => void;
let network: jest.Mock;

beforeEach(async () => {
  stored = new Map([[STORAGE_KEY, JSON.stringify(syntheticSession())]]);
  network = jest.fn(() => { throw new Error('Unexpected network request in auth test'); });
  mockAuth = new AuthClient({
    url: 'https://auth.example.test',
    storageKey: STORAGE_KEY,
    storage: {
      getItem: async (key) => stored.get(key) ?? null,
      setItem: async (key, value) => { stored.set(key, value); },
      removeItem: async (key) => { stored.delete(key); },
    },
    persistSession: true,
    autoRefreshToken: false,
    detectSessionInUrl: false,
    fetch: network,
  });
  await mockAuth.initialize();
  jest.isolateModules(() => {
    service = jest.requireActual('../auth-service.native').cloudAuthService;
  });
  unsubscribe = service.subscribe(() => undefined);
  await service.restore();
  expect(service.getSnapshot().status).toBe('signed_in');
});

afterEach(async () => {
  unsubscribe();
  await mockAuth.stopAutoRefresh();
  expect(network).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});

describe('sign out with the installed Supabase auth client', () => {
  it('keeps the account visible and reports an offline error when refresh fails before logout', async () => {
    stored.set(STORAGE_KEY, JSON.stringify({
      ...syntheticSession(),
      expires_at: Math.floor(Date.now() / 1000) - 60,
    }));
    // Force only the refresh transport outcome; use the SDK's real session loading,
    // sign-out, persistence, and subscription behavior.
    const refresh = mockAuth as unknown as {
      _refreshAccessToken: () => Promise<unknown>;
    };
    jest.spyOn(refresh, '_refreshAccessToken').mockResolvedValue({
      data: { session: null, user: null },
      error: new AuthRetryableFetchError('Network request failed', 0),
    });
    const revoke = jest.spyOn(mockAuth.admin, 'signOut');

    await expect(service.signOut()).rejects.toMatchObject({ code: 'offline' });

    expect(stored.has(STORAGE_KEY)).toBe(true);
    expect(revoke).not.toHaveBeenCalled();
    expect(service.getSnapshot()).toMatchObject({
      status: 'signed_in',
      userId: 'synthetic-user',
      email: 'pilot@example.test',
      lastError: { code: 'offline', message: expect.stringContaining('Try again') },
    });
  });

  it('preserves a completed local logout when remote revocation reports an error', async () => {
    jest.spyOn(mockAuth.admin, 'signOut').mockResolvedValue({
      data: null,
      error: new AuthRetryableFetchError('Network request failed', 0),
    });

    await expect(service.signOut()).rejects.toMatchObject({ code: 'offline' });

    expect(stored.has(STORAGE_KEY)).toBe(false);
    expect(service.getSnapshot()).toMatchObject({
      status: 'signed_out', userId: null, email: null, lastError: { code: 'offline' },
    });
  });

  it('clears the account and saved session after successful logout', async () => {
    jest.spyOn(mockAuth.admin, 'signOut').mockResolvedValue({ data: null, error: null });

    await expect(service.signOut()).resolves.toBeUndefined();

    expect(stored.has(STORAGE_KEY)).toBe(false);
    expect(service.getSnapshot()).toEqual({
      status: 'signed_out', userId: null, email: null, lastError: null,
    });
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('email code requests', () => {
  it('normalizes the requested address and permits first-time users', async () => {
    const send = jest.spyOn(mockAuth, 'signInWithOtp').mockResolvedValue({ data: { user: null, session: null }, error: null });
    await service.requestOtp(' Pilot@Example.test ');
    expect(send).toHaveBeenCalledWith({ email: 'pilot@example.test', options: { shouldCreateUser: true } });
  });

  it('excludes conflicting account operations until the original request settles', async () => {
    const request = deferred<any>();
    const send = jest.spyOn(mockAuth, 'signInWithOtp').mockReturnValue(request.promise);
    const verify = jest.spyOn(mockAuth, 'verifyOtp');
    const signOut = jest.spyOn(mockAuth, 'signOut');
    const first = service.requestOtp('pilot@example.test');
    for (const second of [() => service.requestOtp('other@example.test'), () => service.verifyOtp('pilot@example.test', '12345678'), () => service.signOut(), () => service.deleteAccount()]) {
      await expect(second()).rejects.toThrow('still finishing');
    }
    expect(send).toHaveBeenCalledTimes(1); expect(verify).not.toHaveBeenCalled(); expect(signOut).not.toHaveBeenCalled();
    request.resolve({ data: { user: null, session: null }, error: null }); await first;
    await service.requestOtp('other@example.test'); expect(send).toHaveBeenCalledTimes(2);
  });

  it('retains requested session establishment after dismissal, without putting OTP errors into the global snapshot', async () => {
    const request = deferred<any>();
    jest.spyOn(mockAuth, 'verifyOtp').mockReturnValue(request.promise);
    const checking = service.verifyOtp('pilot@example.test', '1234 5678');
    unsubscribe(); // The form/provider may leave while the SDK request is still running.
    await expect(service.requestOtp('other@example.test')).rejects.toThrow('still finishing');
    request.resolve({ data: { session: syntheticSession(), user: syntheticSession().user }, error: null });
    await checking;
    expect(service.getSnapshot()).toMatchObject({ status: 'signed_in', userId: 'synthetic-user', lastError: null });
    expect(mockAuth.verifyOtp).toHaveBeenCalledWith({ email: 'pilot@example.test', token: '12345678', type: 'email' });
  });

  it.each([
    ['validation_failed', 'invalid_code', 'not right'],
    ['otp_expired', 'expired_code', 'expired'],
    ['over_email_send_rate_limit', 'rate_limited', 'Wait a minute'],
    ['over_request_rate_limit', 'rate_limited', 'Wait a minute'],
  ])('maps %s to an actionable local error', async (code, mapped, copy) => {
    jest.spyOn(mockAuth, 'verifyOtp').mockResolvedValue({ data: { user: null, session: null }, error: { code, message: 'server failure' } } as any);
    await expect(service.verifyOtp('pilot@example.test', '12345678')).rejects.toMatchObject({ code: mapped, message: expect.stringContaining(copy) });
    expect(service.getSnapshot().lastError).toBeNull();
    expect(mockAuth.verifyOtp).toHaveBeenCalledTimes(code === 'validation_failed' || code === 'otp_expired' ? 2 : 1);
  });

  it('falls back to signup verification for a new-user code and never repeats transport failures', async () => {
    const verify = jest.spyOn(mockAuth, 'verifyOtp')
      .mockResolvedValueOnce({ data: { user: null, session: null }, error: { code: 'otp_expired', message: 'Rejected' } } as any)
      .mockResolvedValueOnce({ data: { user: syntheticSession().user, session: syntheticSession() }, error: null });
    await service.verifyOtp('new@example.test', '12345678');
    expect(verify).toHaveBeenLastCalledWith({ email: 'new@example.test', token: '12345678', type: 'signup' });
    verify.mockClear().mockRejectedValue(new TypeError('Network request failed'));
    await expect(service.verifyOtp('new@example.test', '12345678')).rejects.toMatchObject({ code: 'offline' });
    expect(verify).toHaveBeenCalledTimes(1); expect(service.getSnapshot().lastError).toBeNull();
  });

  it('releases the request guard after a failed send without leaking its error', async () => {
    const send = jest.spyOn(mockAuth, 'signInWithOtp').mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({ data: { user: null, session: null }, error: null });
    await expect(service.requestOtp('pilot@example.test')).rejects.toMatchObject({ code: 'offline' });
    expect(service.getSnapshot().lastError).toBeNull();
    await service.requestOtp('pilot@example.test'); expect(send).toHaveBeenCalledTimes(2);
  });
});

it('deduplicates session restoration and refuses overlapping code requests', async () => {
  const read = deferred<any>();
  const getSession = jest.spyOn(mockAuth, 'getSession').mockReturnValue(read.promise);
  const first = service.restore(); const second = service.restore();
  expect(getSession).toHaveBeenCalledTimes(1);
  await expect(service.requestOtp('qa@example.test')).rejects.toThrow('still finishing');
  read.resolve({ data: { session: syntheticSession() }, error: null });
  await Promise.all([first, second]); expect(service.getSnapshot().status).toBe('signed_in');
});

it('does not apply a stale restore over a pending verification', async () => {
  const request = deferred<any>();
  jest.spyOn(mockAuth, 'verifyOtp').mockReturnValue(request.promise);
  const getSession = jest.spyOn(mockAuth, 'getSession');
  const verify = service.verifyOtp('qa@example.test', '12345678');
  await service.restore(); expect(getSession).not.toHaveBeenCalled();
  request.resolve({ data: { session: syntheticSession(), user: syntheticSession().user }, error: null }); await verify;
});
