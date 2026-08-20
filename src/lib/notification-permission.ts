import { PermissionsAndroid, Platform } from 'react-native';

/**
 * The POST_NOTIFICATIONS permission, which Android 13 (API 33) introduced.
 *
 * The recorder's foreground-service notification is what stops Android killing a flight
 * to save power. Without this permission that notification is silently suppressed —
 * exactly the case where a long recording is most at risk — so setup asks for it, while
 * being honest that it is recommended rather than required.
 *
 * Uses React Native's `PermissionsAndroid` rather than `expo-notifications`: the app does
 * not send notifications of its own, and a bare permission request does not justify a
 * native module.
 */

export type NotificationPermission = 'unsupported' | 'granted' | 'denied' | 'unknown';

const POST_NOTIFICATIONS = 'android.permission.POST_NOTIFICATIONS' as const;

/** Android 13 is the first version that has the permission to ask for. */
function supported(): boolean {
  return Platform.OS === 'android' && Number(Platform.Version) >= 33;
}

export async function getNotificationPermission(): Promise<NotificationPermission> {
  if (!supported()) return 'unsupported';
  try {
    const granted = await PermissionsAndroid.check(POST_NOTIFICATIONS);
    return granted ? 'granted' : 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!supported()) return 'unsupported';
  try {
    const result = await PermissionsAndroid.request(POST_NOTIFICATIONS);
    return result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied';
  } catch {
    // A refusal here must never stop setup: the notification is a safeguard, not a
    // requirement, and recording works without it.
    return 'unknown';
  }
}
