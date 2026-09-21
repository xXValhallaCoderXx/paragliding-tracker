import type { SharingPreferences } from '@/social/feed-types';
import type { PublicationEnvironment } from './publication-worker';

export interface LocalPublicationView {
  state: 'private' | 'pending' | 'shared' | 'hidden' | 'error';
  activityId: string | null;
  error: string | null;
  hasLocalOverride: boolean;
  pendingHide: boolean;
}
export interface PublicationService {
  subscribe(listener: () => void): () => void;
  getView(ownerId: string, flightId: string): Promise<LocalPublicationView>;
  setPreferences(ownerId: string, preferences: SharingPreferences): Promise<void>;
  share(ownerId: string, flightId: string): Promise<void>;
  hide(ownerId: string, flightId: string): Promise<void>;
  retry(ownerId: string, flightId: string): Promise<void>;
  requestSync(): Promise<void>;
  setEnvironment(environment: Partial<PublicationEnvironment>): void;
  authChanged(): Promise<void>;
}
