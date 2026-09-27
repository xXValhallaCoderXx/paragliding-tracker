/** Synchronous account boundaries, including an account changing away and back. */
export interface FlightActionScope {
  revision: number;
  authUserId: string | null;
  journalOwnerId: string | null;
}
let scope: FlightActionScope = { revision: 0, authUserId: null, journalOwnerId: null };
const listeners = new Set<() => void>();
export const captureFlightScope = (): FlightActionScope => ({ ...scope });
export const flightScopeRevision = () => scope.revision;
export function subscribeFlightScope(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function update(field: 'authUserId' | 'journalOwnerId', value: string | null) {
  if (scope[field] === value) return;
  scope = { ...scope, [field]: value, revision: scope.revision + 1 };
  for (const listener of listeners) listener();
}
export const setFlightAuthIdentity = (id: string | null) => update('authUserId', id);
export const setFlightJournalOwner = (id: string | null) => update('journalOwnerId', id);
export function assertFlightScope(expected: FlightActionScope) {
  if (expected.revision !== scope.revision || expected.authUserId !== scope.authUserId || expected.journalOwnerId !== scope.journalOwnerId) {
    throw new Error('The account changed. Reopen this flight before continuing.');
  }
}
