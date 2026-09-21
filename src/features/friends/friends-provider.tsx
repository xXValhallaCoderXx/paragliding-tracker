import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppState } from 'react-native';
import * as Network from 'expo-network';
import { cloudAuthService } from '@/cloud/auth-service';
import { useCloudAuth } from '@/features/account/auth-provider';
import { socialService } from '@/social/api';
import { EMPTY_FRIENDS, FriendsController } from '@/social/controller';
import type { FriendsContextValue } from '@/social/types';

const FriendsContext = createContext<FriendsContextValue | null>(null);

export function FriendsProvider({ children }: { children: ReactNode }) {
  const auth = useCloudAuth();
  const [controller] = useState(() => new FriendsController(socialService, () => cloudAuthService.getSnapshot()));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const identityKey = auth.status === 'signed_in' ? auth.userId : null;
  const status = auth.status === 'signed_in' ? 'ready' : auth.status;
  const actions = useMemo(() => ({
    refresh: async () => { controller.assertOwner(identityKey); await controller.refresh(); },
    saveProfile: async (...args: Parameters<FriendsController['saveProfile']>) => { controller.assertOwner(identityKey); await controller.saveProfile(...args); },
    requestPilot: async (userId: string) => { controller.assertOwner(identityKey); return controller.requestPilot(userId); },
    blockPilot: async (userId: string) => { controller.assertOwner(identityKey); await controller.blockPilot(userId); },
    searchPilots: async (...args: Parameters<FriendsController['searchPilots']>) => { controller.assertOwner(identityKey); return controller.searchPilots(...args); },
    changeRelationship: async (...args: Parameters<FriendsController['changeRelationship']>) => {
      controller.assertOwner(identityKey); await controller.changeRelationship(...args);
    },
    getFriendProfile: async (id: string) => { controller.assertOwner(identityKey); return controller.getFriendProfile(id); },
  }), [controller, identityKey]);

  useEffect(() => cloudAuthService.subscribe(controller.syncIdentity), [controller]);
  useEffect(() => { controller.syncIdentity(); }, [controller, auth.status, auth.userId]);
  useEffect(() => {
    let mounted = true;
    let networkRevision = 0;
    const applyNetwork = (network: Network.NetworkState) => {
      controller.setEnvironment({ online: network.isConnected === true && network.isInternetReachable !== false });
    };
    const readNetwork = async () => {
      const revision = ++networkRevision;
      try {
        const network = await Network.getNetworkStateAsync();
        if (mounted && revision === networkRevision) applyNetwork(network);
      } catch { if (mounted && revision === networkRevision) controller.setEnvironment({ online: false }); }
    };
    controller.setEnvironment({ foreground: AppState.currentState === 'active', online: false });
    if (AppState.currentState === 'active') void readNetwork();
    const network = Network.addNetworkStateListener(state => { networkRevision += 1; if (mounted) applyNetwork(state); });
    const app = AppState.addEventListener('change', state => {
      networkRevision += 1;
      controller.setEnvironment({ foreground: state === 'active', online: false });
      if (state === 'active') void readNetwork();
    });
    return () => {
      mounted = false;
      networkRevision += 1;
      network.remove(); app.remove();
      controller.setEnvironment({ foreground: false, online: false });
    };
  }, [controller]);

  // Auth context changes during render before effects run. Never expose a previous
  // owner's cached names or relationships in that intervening render.
  const value = useMemo<FriendsContextValue>(() => {
    const visible = identityKey && snapshot.identityKey === identityKey ? snapshot : {
      ...EMPTY_FRIENDS, identityKey, revision: snapshot.revision,
    };
    return { ...visible, identityKey, status, ...actions };
  }, [snapshot, identityKey, status, actions]);
  return <FriendsContext.Provider value={value}>{children}</FriendsContext.Provider>;
}

export function useFriends(): FriendsContextValue {
  const context = useContext(FriendsContext);
  if (!context) throw new Error('useFriends must be used inside FriendsProvider.');
  return context;
}
