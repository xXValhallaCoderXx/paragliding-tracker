import React from 'react';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import * as Location from 'expo-location';
import { Button, LinkButton, ListRow, Notice } from '@/components/ui';
import { PermissionsStep } from '../components/permissions-step';
import { useSetupPermissions } from '../use-setup-permissions';
import { locationAction, readLocationPermissions, requestSetupLocation } from '@/lib/location-permission';
import { openSystemScreen } from '@/lib/system-settings';
import { act, create } from '../../../../tests/support/renderer';

jest.mock('expo-location', () => ({
  getForegroundPermissionsAsync: jest.fn(), getBackgroundPermissionsAsync: jest.fn(), hasServicesEnabledAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(), requestBackgroundPermissionsAsync: jest.fn(),
}));
jest.mock('@/lib/system-settings', () => ({ openSystemScreen: jest.fn() }));
let hook: ReturnType<typeof useSetupPermissions>;
function Probe() { const value = useSetupPermissions(); React.useEffect(() => { hook = value; }); return null; }
let rendered: ReturnType<typeof create>;
const activeListeners = new Set<(state: any) => void>();
const response = (status = 'undetermined', canAskAgain = true, accuracy = 'none') => ({ status, granted: status === 'granted', canAskAgain, expires: 'never', android: { accuracy } }) as Location.LocationPermissionResponse;
const control = (label: string) => [...rendered.root.findAllByType(Button), ...rendered.root.findAllByType(LinkButton)]
  .find((node: any) => node.props.label === label)!;
const row = (label: string) => rendered.root.findAllByType(ListRow).find((node: any) => node.props.label === label)!;
async function run(fn: () => unknown) { await act(async () => { await fn(); }); }
async function mount(probe = false) { await run(() => { rendered = create(React.createElement(probe ? Probe : PermissionsStep, { onContinue: jest.fn() })); }); }
async function foreground() { await run(() => { for (const listener of activeListeners) listener('active'); }); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }

beforeEach(() => {
  jest.clearAllMocks(); activeListeners.clear();
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  Object.defineProperty(Platform, 'Version', { value: 36, configurable: true });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, callback) => {
    activeListeners.add(callback); return { remove: () => { activeListeners.delete(callback); } };
  });
  jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
  jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(response());
  jest.mocked(Location.getBackgroundPermissionsAsync).mockResolvedValue(response());
  jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValue(true);
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue(response('denied'));
  jest.mocked(Location.requestBackgroundPermissionsAsync).mockResolvedValue(response('denied'));
  jest.mocked(openSystemScreen).mockResolvedValue();
});
afterEach(async () => { await run(() => rendered?.unmount()); jest.restoreAllMocks(); });

it('reads on entry and foreground without prompting or requesting fixes', async () => {
  await mount(); expect(row('Location · precise').props.value).toBe('NOT REQUESTED');
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled(); expect(PermissionsAndroid.request).not.toHaveBeenCalled();
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(response('granted', true, 'fine'));
  jest.mocked(Location.getBackgroundPermissionsAsync).mockResolvedValue(response('granted'));
  await foreground();
  expect(row('Location · precise').props.value).toBe('PRECISE'); expect(row('Allow all the time').props.value).toBe('ALLOWED');
  expect(control('Continue')).toBeDefined(); expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
});

it('distinguishes approximate access, permanent denial and device location off', async () => {
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(response('granted', false, 'coarse'));
  await mount(); expect(row('Location · precise').props.value).toBe('APPROXIMATE');
  await run(() => control('Open app settings').props.onPress()); expect(openSystemScreen).toHaveBeenCalledWith('open_app_settings');
  jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValue(false); await foreground();
  expect(row('Device location').props.value).toBe('OFF');
  await run(() => control('Open location settings').props.onPress()); expect(openSystemScreen).toHaveBeenLastCalledWith('open_location_settings');
  jest.mocked(Location.hasServicesEnabledAsync).mockResolvedValue(true);
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(response('denied', true)); await foreground();
  expect(control('Retry location permission')).toBeDefined();
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(response('denied', false)); await foreground();
  expect(control('Open app settings')).toBeDefined(); expect(control('Not now — continue setup')).toBeDefined();
});

it('requests foreground before background and never chains notifications', async () => {
  const events: string[] = [];
  jest.mocked(Location.requestForegroundPermissionsAsync).mockImplementation(async () => { events.push('foreground'); return response('granted', true, 'fine'); });
  jest.mocked(Location.requestBackgroundPermissionsAsync).mockImplementation(async () => { events.push('background'); return response('granted'); });
  await mount(); await run(() => control('Allow location').props.onPress());
  expect(events).toEqual(['foreground', 'background']); expect(PermissionsAndroid.request).not.toHaveBeenCalled();
});

it('does not request background after approximate access or denial, and never requests a permanently denied permission', async () => {
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValue(response('granted', true, 'coarse'));
  await requestSetupLocation(() => true); expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(response('denied', false));
  jest.mocked(Location.requestForegroundPermissionsAsync).mockClear();
  await requestSetupLocation(() => true); expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
});

it('offers optional notifications, preserves Not now after denial, and uses Settings after never ask again', async () => {
  await mount(); await run(() => control('Allow notifications — optional').props.onPress());
  expect(row('Notifications').props.value).toBe('NOT ALLOWED'); expect(control('Not now — continue setup')).toBeDefined();
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  jest.mocked(PermissionsAndroid.request).mockResolvedValue(PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN);
  await run(() => control('Retry notifications').props.onPress());
  expect(control('Open notification settings')).toBeDefined();
  await run(() => control('Open notification settings').props.onPress()); expect(openSystemScreen).toHaveBeenCalledWith('open_app_settings');
  jest.mocked(PermissionsAndroid.check).mockResolvedValue(true); await foreground(); // Clear process-local denial.
  expect(row('Notifications').props.value).toBe('ALLOWED');
});

it('shows unavailable checks and Settings/request failures with recoverable exits', async () => {
  jest.mocked(Location.getForegroundPermissionsAsync).mockRejectedValue(new Error('unavailable'));
  await mount(); expect(row('Location · precise').props.value).toBe('UNAVAILABLE');
  expect(control('Retry permission check')).toBeDefined();
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(response('denied', false)); await foreground();
  jest.mocked(openSystemScreen).mockRejectedValue(new Error('cannot open'));
  await run(() => control('Open app settings').props.onPress());
  expect(rendered.root.findAllByType(Notice).some((node: any) => String(node.props.children).includes('could not be opened'))).toBe(true);
  expect(control('Not now — continue setup')).toBeDefined();
});

it('clears a stale notification grant after a failed passive read and retries without prompting', async () => {
  jest.mocked(PermissionsAndroid.check).mockResolvedValue(true);
  await mount(); expect(row('Notifications').props.value).toBe('ALLOWED');
  jest.mocked(PermissionsAndroid.check).mockRejectedValue(new Error('unavailable'));
  await foreground();
  expect(row('Notifications').props.value).toBe('UNAVAILABLE');
  expect(control('Not now — continue setup')).toBeDefined();
  jest.mocked(PermissionsAndroid.check).mockResolvedValue(false);
  await run(() => control('Retry notification check').props.onPress());
  expect(row('Notifications').props.value).toBe('OPTIONAL');
  expect(control('Allow notifications — optional')).toBeDefined();
  expect(PermissionsAndroid.request).not.toHaveBeenCalled();
});

it('prevents duplicate actions and queues Settings-return reads behind the current prompt', async () => {
  const pending = deferred<Location.LocationPermissionResponse>();
  jest.mocked(Location.requestForegroundPermissionsAsync).mockReturnValue(pending.promise);
  await mount(true);
  await run(() => { void hook.perform('location'); void hook.perform('location'); void hook.perform('notifications'); });
  expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalledTimes(1); expect(PermissionsAndroid.request).not.toHaveBeenCalled();
  const reads = jest.mocked(Location.getForegroundPermissionsAsync).mock.calls.length;
  await foreground(); expect(Location.getForegroundPermissionsAsync).toHaveBeenCalledTimes(reads);
  await run(() => pending.resolve(response('denied')));
  expect(hook.busy).toBe(false); expect(Location.getForegroundPermissionsAsync).toHaveBeenCalledTimes(reads + 1);
});

it('ignores old reads after a newer foreground refresh and after unmount', async () => {
  const old = deferred<Location.LocationPermissionResponse>();
  jest.mocked(Location.getForegroundPermissionsAsync).mockReturnValueOnce(old.promise);
  await mount(true);
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(response('granted', true, 'fine'));
  await foreground(); expect(hook.permissions?.foreground.accuracy).toBe('precise');
  await run(() => old.resolve(response('denied'))); expect(hook.permissions?.foreground.accuracy).toBe('precise');
});

it('cancels the background prompt when leaving, keeps re-entry busy, and refreshes the new owner on completion', async () => {
  const pending = deferred<Location.LocationPermissionResponse>();
  jest.mocked(Location.requestForegroundPermissionsAsync).mockReturnValue(pending.promise);
  await mount(true); await run(() => { void hook.perform('location'); });
  await run(() => rendered.unmount()); await mount(true);
  expect(hook.busy).toBe(true);
  await run(() => hook.perform('notifications')); expect(PermissionsAndroid.request).not.toHaveBeenCalled();
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(response('granted', true, 'fine'));
  await run(() => pending.resolve(response('granted', true, 'fine')));
  expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  expect(hook.permissions?.foreground.accuracy).toBe('precise');
  expect(hook.busy).toBe(false); expect(hook.checking).toBe(false);
  await run(() => hook.perform('notifications')); expect(PermissionsAndroid.request).toHaveBeenCalledTimes(1);
});

it('keeps a granted state separate from availability of the device service', async () => {
  jest.mocked(Location.getForegroundPermissionsAsync).mockResolvedValue(response('granted', true, 'fine'));
  jest.mocked(Location.getBackgroundPermissionsAsync).mockResolvedValue(response('granted'));
  jest.mocked(Location.hasServicesEnabledAsync).mockRejectedValue(new Error('service'));
  const snapshot = await readLocationPermissions(); expect(snapshot.foreground.accuracy).toBe('precise');
  expect(snapshot.servicesEnabled).toBeNull(); expect(locationAction(snapshot)).toBe('retry');
});
