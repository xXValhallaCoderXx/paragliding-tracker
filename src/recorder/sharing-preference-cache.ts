import type { SharingPreferences } from '@/social/feed-types';
import type { CaptureSharingStamp } from './publication-repository-core';

let context: { owner: string; preferences: SharingPreferences; current(): boolean } | null = null;
let epoch = 0;

/** Cloud orchestration supplies context; recorder construction never loads cloud services. */
export function setCaptureSharingContext(owner: string | null, preferences: SharingPreferences | null, current: () => boolean): void {
  epoch += 1;
  context = owner && preferences ? { owner, preferences: { ...preferences }, current } : null;
}

/** Synchronous, known consent only. Recording never waits for a social network or database read. */
export function captureSharingConsent(operationId: () => string): { stamp: CaptureSharingStamp; isCurrent(): boolean } | null {
  const captured = context;
  const generation = captured?.preferences.generation;
  if (!captured || !captured.preferences.enabled || !generation || !captured.current()) return null;
  const started = epoch;
  return { stamp: { ownerUserId: captured.owner, generation, operationId: operationId() },
    isCurrent: () => started === epoch && captured.current() };
}
