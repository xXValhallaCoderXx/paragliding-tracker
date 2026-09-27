import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { readLocationPermissions, requestSetupLocation, type LocationPermissions } from '@/lib/location-permission';
import { getNotificationPermission, requestNotificationPermission, type NotificationPermission } from '@/lib/notification-permission';
import { openSystemScreen } from '@/lib/system-settings';

// Android dialogs can outlive this step. Keep their exclusion lock across re-entry.
let systemActionRunning = false;
const systemActionListeners = new Set<(completedOwner?: object) => void>();
function subscribeToSystemAction(listener: () => void) {
  systemActionListeners.add(listener);
  return () => { systemActionListeners.delete(listener); };
}
function systemActionSnapshot() { return systemActionRunning; }
function updateSystemAction(running: boolean, completedOwner?: object) {
  systemActionRunning = running;
  for (const listener of systemActionListeners) listener(completedOwner);
}

type Action = 'location' | 'notifications' | 'app-settings' | 'location-settings';

/** One mounted Permissions step owns its results. Foreground refreshes queue behind prompts. */
export function useSetupPermissions() {
  const [permissions, setPermissions] = useState<LocationPermissions | null>(null);
  const [notifications, setNotifications] = useState<NotificationPermission>('unknown');
  const busy = useSyncExternalStore(subscribeToSystemAction, systemActionSnapshot, systemActionSnapshot);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const owner = useRef({ active: false, busy: false, read: 0 });

  const refresh = useCallback(() => {
    const scope = owner.current;
    if (!scope.active) return;
    if (scope.busy) return;
    const read = ++scope.read;
    return Promise.allSettled([readLocationPermissions(), getNotificationPermission()]).then(([location, notification]) => {
      if (!scope.active || scope.read !== read) return;
      setPermissions(location.status === 'fulfilled' ? location.value : null);
      setNotifications(notification.status === 'fulfilled' ? notification.value : 'unavailable');
      setError(location.status === 'rejected' || notification.status === 'rejected'
        ? 'Permissions could not be checked. Retry, or continue setup and check them before recording.' : null);
      setChecking(false);
    });
  }, []);

  useEffect(() => {
    // A fresh owner also makes cleanup safe under React's effect replay.
    const scope = { active: true, busy: false, read: 0 };
    owner.current = scope;
    const onSystemAction = (completedOwner?: object) => {
      // A request from the previous mount can finish after this mount's entry read.
      // Its result belongs to that old owner; this owner gets a fresh passive snapshot.
      if (scope.active && completedOwner && completedOwner !== scope) {
        setChecking(true);
        void refresh();
      }
    };
    systemActionListeners.add(onSystemAction);
    void refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') { setChecking(true); void refresh(); }
    });
    return () => {
      scope.active = false; scope.read += 1; subscription.remove();
      systemActionListeners.delete(onSystemAction);
    };
  }, [refresh]);

  const perform = useCallback(async (action: Action) => {
    const scope = owner.current;
    if (!scope.active || scope.busy || systemActionRunning) return;
    scope.busy = true;
    updateSystemAction(true);
    scope.read += 1; // An older passive read must not replace this request's result.
    setError(null);
    let failure: string | null = null;
    try {
      if (action === 'location') await requestSetupLocation(() => scope.active);
      else if (action === 'notifications') {
        const result = await requestNotificationPermission();
        if (scope.active) setNotifications(result);
      } else await openSystemScreen(action === 'app-settings' ? 'open_app_settings' : 'open_location_settings');
    } catch {
      failure = action.endsWith('settings')
        ? 'Settings could not be opened. Try again, or open this app’s permissions in your phone’s Settings.'
        : 'The permission request could not finish. Try again, or continue setup for now.';
    } finally {
      scope.busy = false;
      if (scope.active) {
        await refresh();
        if (scope.active && failure) setError(failure);
      }
      updateSystemAction(false, scope);
    }
  }, [refresh]);

  const retry = useCallback(async () => { setChecking(true); await refresh(); }, [refresh]);
  return { permissions, notifications, busy, checking, error, refresh: retry, perform };
}
