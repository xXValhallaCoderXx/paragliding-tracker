import { NetworkStateType, type NetworkState } from 'expo-network';

import type { OfflineEnvironment } from './types';

export function downloadNetwork(state: NetworkState): OfflineEnvironment['network'] {
  if (state.isConnected === false || state.isInternetReachable === false || state.type === NetworkStateType.NONE) return 'offline';
  if (state.isConnected !== true || state.isInternetReachable !== true) return 'unknown';
  return state.type === NetworkStateType.WIFI ? 'wifi' : 'other';
}
