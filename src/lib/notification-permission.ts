import { PermissionsAndroid, Platform } from 'react-native';

/** Notification visibility is optional and does not guarantee recorder health or continuity.
 * Android's passive check does not report prompt eligibility. Remember a prompt's explicit
 * NEVER_ASK_AGAIN result for this process; never infer permanent denial from a passive false. */
export type NotificationPermission = 'unsupported' | 'granted' | 'denied' | 'blocked' | 'unknown' | 'unavailable';
const POST_NOTIFICATIONS = 'android.permission.POST_NOTIFICATIONS' as const;
let lastDenial: 'denied' | 'blocked' | null = null;
function supported(): boolean {
  return Platform.OS === 'android' && Number(Platform.Version) >= 33;
}
export async function getNotificationPermission(): Promise<NotificationPermission> {
  if (!supported()) return 'unsupported';
  if (await PermissionsAndroid.check(POST_NOTIFICATIONS)) { lastDenial = null; return 'granted'; }
  return lastDenial ?? 'unknown';
}
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!supported()) return 'unsupported';
  const result = await PermissionsAndroid.request(POST_NOTIFICATIONS);
  if (result === PermissionsAndroid.RESULTS.GRANTED) { lastDenial = null; return 'granted'; }
  lastDenial = result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? 'blocked' : 'denied';
  return lastDenial;
}
