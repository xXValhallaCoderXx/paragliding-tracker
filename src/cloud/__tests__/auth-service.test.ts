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
