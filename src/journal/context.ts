/** Synchronous visibility boundary; no service subscriptions during module construction. */
let owner: string | null = null;
let epoch = 0;
export type JournalChange = { kind: 'owner' | 'metadata' | 'artifact' | 'delete'; flightId?: string };
const listeners = new Set<(change: JournalChange) => void>();
export const journalOwner = () => owner;
export const journalEpoch = () => epoch;
export function setJournalOwner(next: string | null): void {
  if (owner === next) return;
  owner = next;
  epoch += 1;
  notifyJournal({ kind: 'owner' });
}
export function notifyJournal(change: JournalChange): void {
  for (const listener of listeners) listener(change);
}
export function subscribeJournal(listener: (change: JournalChange) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export async function visibleJournalRead<T>(read: (ownerId: string | null) => Promise<T>): Promise<T> {
  const started = epoch;
  const result = await read(owner);
  if (started !== epoch) throw new Error('The account changed. Please reopen this flight.');
  return result;
}
