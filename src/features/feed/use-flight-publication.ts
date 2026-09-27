import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { cloudAuthService } from '@/cloud/auth-service';
import { publicationService } from '@/cloud/publication-service';
import { useCloudAuth } from '@/features/account/auth-provider';
import type { FlightPublicationView } from '@/social/feed-types';
import { errorMessage } from '@/lib/format/error-message';
import { SocialError } from '@/social/types';
import { assertFlightScope, captureFlightScope } from '@/lib/flight-scope';
import { useFeed } from './feed-provider';

type State = Pick<FlightPublicationView, 'state' | 'activityId' | 'error' | 'pendingHide'>;
type Read = { scope: string; loading: boolean; value: State };
const EMPTY: State = { state: 'unknown', activityId: null, error: null, pendingHide: false };

export function useFlightPublication(flightId: string | null): FlightPublicationView {
  const [identityScope] = useState(captureFlightScope);
  const auth = useCloudAuth();
  const feed = useFeed();
  const owner = auth.status === 'signed_in' ? auth.userId : null;
  const scope = `${owner}:${flightId}`;
  const online = feed.available && feed.identityKey === owner;
  const [read, setRead] = useState<Read>({ scope, loading: true, value: EMPTY });
  const [working, setWorking] = useState<string | null>(null);
  const sequence = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const actionScope = useRef<string | null>(null);
  const focused = useRef(false);
  const focusGeneration = useRef(0);
  const { getPublication } = feed;
  const assertOwner = useCallback(() => {
    assertFlightScope(identityScope);
    const current = cloudAuthService.getSnapshot();
    if (!owner || !flightId || current.status !== 'signed_in' || current.userId !== owner) throw new SocialError('stale', 'Your account changed. Reopen this flight.');
  }, [flightId, identityScope, owner]);
  const refresh = useCallback(async () => {
    assertOwner();
    if (!focused.current) return;
    const revision = ++sequence.current;
    pending.current?.abort(); const abort = new AbortController(); pending.current = abort;
    setRead(current => ({ scope, loading: true, value: current.scope === scope ? current.value : EMPTY }));
    const current = () => revision === sequence.current && !abort.signal.aborted;
    try {
      const local = await publicationService.getView(owner!, flightId!); assertOwner();
      let value: State = { state: local.state, activityId: local.activityId, error: local.error, pendingHide: local.pendingHide };
      if (online) {
        try {
          if (!current()) return;
          const remote = await getPublication(flightId!); assertOwner();
          if (!local.hasLocalOverride) value = { state: remote.state, activityId: remote.activityId, error: null, pendingHide: false };
        } catch (error) {
          assertOwner();
          if (!local.hasLocalOverride) throw error;
          // A durable local hide/upload is still pending when its remote read fails.
        }
      } else if (!local.hasLocalOverride && local.state === 'private') {
        value = { ...EMPTY, error: 'Connect to check this flight’s sharing status.' };
      }
      if (current()) setRead({ scope, loading: false, value });
    } catch (error) {
      if (current()) setRead({ scope, loading: false, value: { ...EMPTY, error: errorMessage(error) } });
    } finally { if (pending.current === abort) pending.current = null; }
  }, [assertOwner, flightId, getPublication, online, owner, scope]);
  useFocusEffect(useCallback(() => {
    focused.current = true; focusGeneration.current += 1;
    if (owner && flightId) void refresh().catch(() => undefined);
    const unsubscribe = publicationService.subscribe(() => { if (owner && flightId) void refresh().catch(() => undefined); });
    return () => { focused.current = false; focusGeneration.current += 1; unsubscribe(); sequence.current += 1; pending.current?.abort(); };
  }, [flightId, owner, refresh]));
  useEffect(() => () => { sequence.current += 1; pending.current?.abort(); }, []);
  const mutate = useCallback(async (action: 'share' | 'hide' | 'retry') => {
    assertOwner();
    if (!focused.current) throw new SocialError('stale', 'Reopen this flight before changing sharing.');
    if (actionScope.current === scope) throw new SocialError('busy', 'Wait for this sharing change to finish.');
    if (action === 'share' && !online) throw new SocialError('unavailable', 'Connect to share this flight.');
    const generation = focusGeneration.current;
    actionScope.current = scope; setWorking(scope);
    try {
      await publicationService[action](owner!, flightId!); assertOwner();
      if (focused.current && generation === focusGeneration.current) {
        await refresh();
        if (online) void feed.refresh().catch(() => undefined);
      }
    } finally { if (actionScope.current === scope) actionScope.current = null; setWorking(current => current === scope ? null : current); }
  }, [assertOwner, feed, flightId, online, owner, refresh, scope]);
  const visible = read.scope === scope ? read : { scope, loading: true, value: EMPTY };
  return { ...visible.value, busy: visible.loading || working === scope, available: Boolean(owner && flightId), online,
    refresh, share: () => mutate('share'), hide: () => mutate('hide'), retry: () => mutate('retry') };
}
