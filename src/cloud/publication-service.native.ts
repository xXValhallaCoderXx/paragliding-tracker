import * as Crypto from 'expo-crypto';
import { journalEpoch, journalOwner, subscribeJournal } from '@/journal/context';
import { setCaptureSharingContext } from '@/recorder/sharing-preference-cache';
import { feedService } from '@/social/feed-api';
import type { SharingPreferences } from '@/social/feed-types';
import { SocialError } from '@/social/types';
import { cloudAuthService } from './auth-service';
import { publicationRepository as repository } from './publication-repository.native';
import { buildPublicationArtifact, publicationBackupReady, publicationSourceExists } from './publication-source.native';
import type { PublicationService } from './publication-types';
import { PublicationWorker } from './publication-worker';
import { cloudSyncEngine } from './sync-engine';

const listeners = new Set<() => void>();
let installed = false;
let boundOwner: string | null = null;
let boundJournalEpoch = -1;
let generation = 0;
let authGeneration = 0;
let preferences: SharingPreferences | null = null;
let preferencesRead: Promise<void> = Promise.resolve();
const mutations = new Map<string, Promise<void>>();
const manualReads = new Set<AbortController>();
const changed = () => { for (const listener of listeners) listener(); };
const authOwner = () => {
  const auth = cloudAuthService.getSnapshot();
  return auth.status === 'signed_in' ? auth.userId : null;
};
const owner = () => {
  const current = authOwner();
  return current === journalOwner() ? current : null;
};
const stale = () => new SocialError('stale', 'The account changed. Reopen this flight to continue.');
const worker = new PublicationWorker({ repository, remote: feedService, owner,
  sourceExists: publicationSourceExists, backupReady: publicationBackupReady,
  artifact: buildPublicationArtifact, changed });

function kick(): void {
  void worker.requestSync().catch(() => undefined);
}
function invalidate(): void {
  worker.invalidate();
  for (const controller of manualReads) controller.abort();
  manualReads.clear();
}
function guardFor(expected: string): () => void {
  const started = generation;
  const journal = journalEpoch();
  const guard = () => {
    if (started !== generation || journal !== journalEpoch() || owner() !== expected) throw stale();
  };
  guard();
  return guard;
}
function authGuardFor(expected: string): () => void {
  const started = authGeneration;
  const guard = () => { if (started !== authGeneration || authOwner() !== expected) throw stale(); };
  guard(); return guard;
}
function updateCaptureContext(expected: string, value: SharingPreferences): void {
  const started = generation;
  const journal = journalEpoch();
  setCaptureSharingContext(expected, value,
    () => started === generation && journal === journalEpoch() && owner() === expected);
}
function install(): void {
  if (installed) return;
  installed = true;
  cloudAuthService.subscribe(() => { void publicationService.authChanged().catch(() => undefined); });
  let lastSyncAt = cloudSyncEngine.getSnapshot().lastSyncAt;
  cloudSyncEngine.subscribe(snapshot => {
    if (snapshot.lastSyncAt === lastSyncAt) return;
    lastSyncAt = snapshot.lastSyncAt;
    kick();
  });
  subscribeJournal(change => {
    if (change.kind === 'owner') void publicationService.authChanged().catch(() => undefined);
    else {
      if (change.kind === 'delete') invalidate();
      kick();
    }
  });
}
function mutate(ownerId: string, flightId: string, task: () => Promise<void>): Promise<void> {
  install();
  const key = `${ownerId}:${flightId}`;
  const existing = mutations.get(key);
  if (existing) return Promise.reject(new SocialError('busy', 'A sharing change is already in progress.'));
  const operation = task().finally(() => { if (mutations.get(key) === operation) mutations.delete(key); });
  mutations.set(key, operation);
  return operation;
}

export const publicationService: PublicationService = {
  subscribe(listener) { install(); listeners.add(listener); return () => { listeners.delete(listener); }; },
  async authChanged() {
    install();
    const current = authOwner();
    const journal = journalEpoch();
    if (current === boundOwner && journal === boundJournalEpoch) return preferencesRead;
    if (current !== boundOwner) authGeneration += 1;
    boundOwner = current; boundJournalEpoch = journal; generation += 1;
    preferences = null;
    setCaptureSharingContext(null, null, () => false);
    invalidate(); changed();
    if (!current) { preferencesRead = Promise.resolve(); return; }
    const guard = authGuardFor(current);
    preferencesRead = (async () => {
      const cached = await repository.getPreferences(current); guard();
      preferences = cached;
      if (cached) updateCaptureContext(current, cached);
      kick();
    })().catch(error => {
      if (authOwner() === current && boundJournalEpoch === journal) boundJournalEpoch = -1;
      throw error;
    });
    return preferencesRead;
  },
  async setPreferences(ownerId, value) {
    await publicationService.authChanged();
    const guard = authGuardFor(ownerId);
    if (preferences?.enabled === value.enabled && preferences.generation === value.generation) return;
    // Stop an older consent operation before waiting for the serialized database write.
    invalidate();
    setCaptureSharingContext(null, null, () => false);
    await repository.setPreferences(ownerId, value, guard); guard();
    preferences = { ...value };
    updateCaptureContext(ownerId, value);
    changed();
    kick();
  },
  async getView(ownerId, flightId) {
    install();
    const guard = guardFor(ownerId);
    const intent = await repository.get(ownerId, flightId); guard();
    if (!intent || intent.state === 'cancelled') return { state: 'private', activityId: null,
      error: null, hasLocalOverride: false, pendingHide: false };
    return { state: intent.state === 'pending' && intent.error ? 'error' : intent.state,
      activityId: intent.activityId, error: intent.error,
      hasLocalOverride: intent.state !== 'shared', pendingHide: intent.state === 'pending' && intent.action === 'hide' };
  },
  share(ownerId, flightId) {
    return mutate(ownerId, flightId, async () => {
      await publicationService.authChanged();
      const guard = guardFor(ownerId);
      if (!worker.eligible()) throw new SocialError('unavailable', 'Connect to the internet and finish any active recording before sharing.');
      if (!await publicationSourceExists(ownerId, flightId)) throw new SocialError('unavailable', 'This saved flight is unavailable for this account.');
      guard();
      const existing = await repository.get(ownerId, flightId); guard();
      if (existing?.state === 'pending' && existing.action === 'share') {
        await repository.retry(ownerId, flightId, guard); guard(); changed(); kick(); return;
      }
      await cloudSyncEngine.requestSync('manual'); guard();
      if (!worker.eligible()) throw new SocialError('unavailable', 'Flight sharing is paused. Try again when connected and the recorder is idle.');
      if (!await publicationBackupReady(ownerId, flightId)) throw new SocialError('flight_not_ready', 'Back up this saved flight before sharing it.');
      guard();
      const controller = new AbortController(); manualReads.add(controller);
      try {
        const remote = await feedService.getPublication(flightId, controller.signal); guard();
        if (controller.signal.aborted || !worker.eligible()) throw stale();
        // Only this explicit action obtains a revision. Every retry reuses it.
        await repository.queueManual(ownerId, flightId, Crypto.randomUUID(), remote.revision, guard); guard();
        changed();
      } finally { manualReads.delete(controller); }
      kick();
    });
  },
  hide(ownerId, flightId) {
    return mutate(ownerId, flightId, async () => {
      const guard = guardFor(ownerId);
      invalidate();
      await repository.queueHide(ownerId, flightId, Crypto.randomUUID(), guard); guard(); changed();
      kick();
    });
  },
  retry(ownerId, flightId) {
    return mutate(ownerId, flightId, async () => {
      const guard = guardFor(ownerId);
      await repository.retry(ownerId, flightId, guard); guard(); changed();
      kick();
    });
  },
  requestSync() { install(); return worker.requestSync(); },
  setEnvironment(environment) {
    install();
    if (environment.foreground === false || environment.online === false || environment.recorderBusy === true || environment.recorderReady === false) invalidate();
    worker.setEnvironment(environment);
  },
};
