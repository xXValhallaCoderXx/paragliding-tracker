import { SocialError } from '@/social/types';
import type { PublicationService } from './publication-types';

const unsupported = async () => { throw new SocialError('unavailable', 'Flight sharing is available in the Android app.'); };
export const publicationService: PublicationService = {
  subscribe: () => () => undefined,
  getView: async () => ({ state: 'private', activityId: null, error: null, hasLocalOverride: false, pendingHide: false }),
  setPreferences: async () => undefined,
  share: unsupported, hide: unsupported, retry: unsupported,
  requestSync: async () => undefined, authChanged: async () => undefined, setEnvironment: () => undefined,
};
