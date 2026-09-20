import { NetworkStateType } from 'expo-network';
import { downloadNetwork } from '../network';

it('requires validated connectivity and never mistakes VPN or unknown transport for Wi-Fi', () => {
  expect(downloadNetwork({ type: NetworkStateType.WIFI, isConnected: true, isInternetReachable: true })).toBe('wifi');
  expect(downloadNetwork({ type: NetworkStateType.WIFI, isConnected: true, isInternetReachable: false })).toBe('offline');
  expect(downloadNetwork({ type: NetworkStateType.WIFI, isConnected: true })).toBe('unknown');
  for (const type of [NetworkStateType.VPN, NetworkStateType.CELLULAR, NetworkStateType.UNKNOWN]) {
    expect(downloadNetwork({ type, isConnected: true, isInternetReachable: true })).toBe('other');
  }
});
