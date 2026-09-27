import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppState } from 'react-native';
import * as Network from 'expo-network';
import { cloudAuthService } from '@/cloud/auth-service';
import { useCloudAuth } from '@/features/account/auth-provider';
import { useFriends } from '@/features/friends/friends-provider';
import { useRecorderLifecycle } from '@/features/record/recorder-lifecycle';
import { recorderService } from '@/recorder/recorder-service';
import { feedService } from '@/social/feed-api';
import { EMPTY_FEED, FeedController } from '@/social/feed-controller';
import type { FeedContextValue } from '@/social/feed-types';
import { publicationService } from '@/cloud/publication-service';
import { assertFlightScope, captureFlightScope, flightScopeRevision, subscribeFlightScope } from '@/lib/flight-scope';

const FeedContext = createContext<FeedContextValue | null>(null);
export function FeedProvider({ children }: { children: ReactNode }) {
  const auth = useCloudAuth();
  const friends = useFriends();
  const lifecycle = useRecorderLifecycle();
  const [controller] = useState(() => new FeedController(feedService, () => cloudAuthService.getSnapshot(),
    (owner, preferences) => publicationService.setPreferences(owner, preferences)));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const identityKey = auth.status === 'signed_in' ? auth.userId : null;
  const scopeRevision = useSyncExternalStore(subscribeFlightScope, flightScopeRevision, flightScopeRevision);
  const actions = useMemo(() => {
    const scope = captureFlightScope();
    const assertOwner = () => { assertFlightScope(scope); controller.assertOwner(identityKey); };
    return {
      refresh: async () => { assertOwner(); await controller.refresh(); },
      loadMore: async () => { assertOwner(); await controller.loadMore(); },
      setAutoShare: async (enabled: boolean) => { assertOwner(); await controller.setAutoShare(enabled); },
      getDetail: async (id: string) => { assertOwner(); return controller.getDetail(id); },
      getReplay: async (...args: Parameters<FeedController['getReplay']>) => { assertOwner(); return controller.getReplay(...args); },
      getPublication: async (id: string) => { assertOwner(); return controller.getPublication(id); },
      setKudos: async (...args: Parameters<FeedController['setKudos']>) => { assertOwner(); return controller.setKudos(...args); },
      getKudos: async (...args: Parameters<FeedController['getKudos']>) => { assertOwner(); return controller.getKudos(...args); },
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Capture each synchronous authentication/journal generation, including A→B→A.
  }, [controller, identityKey, scopeRevision]);
  useEffect(() => cloudAuthService.subscribe(() => { controller.syncIdentity(); void publicationService.authChanged().catch(() => undefined); }), [controller]);
  useEffect(() => { controller.syncIdentity(); void publicationService.authChanged().catch(() => undefined); }, [controller, auth.status, auth.userId]);
  useEffect(() => { controller.connectionsChanged(); }, [controller, friends.revision]);
  useEffect(() => {
    publicationService.setEnvironment({ recorderReady: lifecycle.ready && !lifecycle.recovering && !lifecycle.recoveryError });
  }, [lifecycle.ready, lifecycle.recovering, lifecycle.recoveryError, lifecycle.recoveryVersion]);
  useEffect(() => {
    let mounted = true;
    let networkRevision = 0;
    const environment = (value: { foreground?: boolean; online?: boolean; recorderBusy?: boolean }) => {
      controller.setEnvironment(value); publicationService.setEnvironment(value);
    };
    const apply = (network: Network.NetworkState) => environment({ online: network.isConnected === true && network.isInternetReachable !== false });
    const readNetwork = async () => {
      const revision = ++networkRevision;
      try { const state = await Network.getNetworkStateAsync(); if (mounted && revision === networkRevision) apply(state); }
      catch { if (mounted && revision === networkRevision) environment({ online: false }); }
    };
    environment({ foreground: AppState.currentState === 'active', online: false });
    if (AppState.currentState === 'active') void readNetwork();
    const network = Network.addNetworkStateListener(state => { networkRevision += 1; if (mounted) apply(state); });
    const app = AppState.addEventListener('change', state => {
      networkRevision += 1; environment({ foreground: state === 'active', online: false });
      if (state === 'active') void readNetwork();
    });
    const activity = recorderService.subscribeActivity(state => {
      environment({ recorderBusy: state.lifecycleBusy || !['idle', 'completed'].includes(state.state) });
    });
    return () => {
      mounted = false; networkRevision += 1; network.remove(); app.remove(); activity();
      environment({ foreground: false, online: false });
    };
  }, [controller]);
  const value = useMemo<FeedContextValue>(() => ({
    ...(identityKey && identityKey === snapshot.identityKey ? snapshot : { ...EMPTY_FEED, identityKey, revision: snapshot.revision }),
    ...actions,
  }), [actions, identityKey, snapshot]);
  return <FeedContext.Provider value={value}>{children}</FeedContext.Provider>;
}
export function useFeed(): FeedContextValue {
  const context = useContext(FeedContext);
  if (!context) throw new Error('useFeed must be used inside FeedProvider.');
  return context;
}
