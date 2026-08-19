import { CloudError, type AuthSnapshot, type CloudAuthService } from './types';

const UNSUPPORTED: AuthSnapshot = {
  status: 'unsupported',
  userId: null,
  email: null,
  lastError: null,
};

function unsupported(): never {
  throw new CloudError(
    'unsupported_platform',
    'Cloud backup is only available in the installed mobile app.',
  );
}

export function initialAuthSnapshot(): AuthSnapshot {
  return UNSUPPORTED;
}

export const cloudAuthService: CloudAuthService = {
  getSnapshot: () => UNSUPPORTED,
  restore: async () => UNSUPPORTED,
  requestOtp: async () => unsupported(),
  verifyOtp: async () => unsupported(),
  signOut: async () => undefined,
  deleteAccount: async () => unsupported(),
  subscribe: (listener) => {
    listener(UNSUPPORTED);
    return () => undefined;
  },
};
