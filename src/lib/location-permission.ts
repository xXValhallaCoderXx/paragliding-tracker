import * as Location from 'expo-location';
import { Platform } from 'react-native';
import type { RecorderPermission } from '@/recorder/types';

/** Keep recorder readiness semantics unchanged: approximate access cannot arm capture. */
export function precisePermission(response: Location.LocationPermissionResponse): boolean {
  if (Platform.OS === 'android') return response.android?.accuracy === 'fine';
  if (Platform.OS === 'ios') return response.ios?.accuracy !== 'reduced';
  return false;
}
export function permissionValue(status: string, precise = true): RecorderPermission {
  if (status === 'undetermined') return 'unknown';
  return status === 'granted' && precise ? 'granted' : 'denied';
}

export type PermissionStatus = 'granted' | 'denied' | 'undetermined' | 'unavailable';
export interface LocationAccess {
  status: PermissionStatus;
  canAskAgain: boolean;
  accuracy: 'precise' | 'approximate' | 'unknown';
}
export interface LocationPermissions {
  foreground: LocationAccess;
  background: LocationAccess;
  servicesEnabled: boolean | null;
}
const unavailable: LocationAccess = { status: 'unavailable', canAskAgain: false, accuracy: 'unknown' };

export function mapLocationAccess(response: Location.LocationPermissionResponse): LocationAccess {
  return {
    status: response.status,
    canAskAgain: response.canAskAgain,
    accuracy: response.granted
      ? precisePermission(response) ? 'precise' : response.android?.accuracy === 'coarse' || response.ios?.accuracy === 'reduced' ? 'approximate' : 'unknown'
      : 'unknown',
  };
}

/** No permission prompts, subscriptions, fixes or recorder operations. */
export async function readLocationPermissions(): Promise<LocationPermissions> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return { foreground: unavailable, background: unavailable, servicesEnabled: null };
  }
  const [foreground, background, services] = await Promise.allSettled([
    Location.getForegroundPermissionsAsync(), Location.getBackgroundPermissionsAsync(), Location.hasServicesEnabledAsync(),
  ]);
  return {
    foreground: foreground.status === 'fulfilled' ? mapLocationAccess(foreground.value) : unavailable,
    background: background.status === 'fulfilled' ? mapLocationAccess(background.value) : unavailable,
    servicesEnabled: services.status === 'fulfilled' ? services.value : null,
  };
}

/** Android requires foreground before background. Never continue a prompt chain after leaving. */
export async function requestSetupLocation(isCurrent: () => boolean): Promise<void> {
  let foreground = await Location.getForegroundPermissionsAsync();
  if (!isCurrent()) return;
  if ((!foreground.granted || !precisePermission(foreground)) && foreground.canAskAgain) {
    foreground = await Location.requestForegroundPermissionsAsync();
  }
  if (!isCurrent() || !foreground.granted || !precisePermission(foreground)) return;
  const background = await Location.getBackgroundPermissionsAsync();
  if (isCurrent() && !background.granted && background.canAskAgain) {
    await Location.requestBackgroundPermissionsAsync();
  }
}

export function locationAction(permissions: LocationPermissions | null): 'checking' | 'retry' | 'request' | 'app-settings' | 'location-settings' | 'done' {
  if (!permissions) return 'checking';
  if (permissions.servicesEnabled === false) return 'location-settings';
  const { foreground, background } = permissions;
  if (foreground.status === 'unavailable' || background.status === 'unavailable' || permissions.servicesEnabled === null) return 'retry';
  if (foreground.status !== 'granted' || foreground.accuracy !== 'precise') {
    return foreground.canAskAgain ? 'request' : 'app-settings';
  }
  if (background.status !== 'granted') return background.canAskAgain ? 'request' : 'app-settings';
  return 'done';
}
