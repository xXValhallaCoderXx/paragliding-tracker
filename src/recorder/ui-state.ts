import type { RecorderSnapshot } from './types';

export interface RecorderNotice {
  tone: 'error' | 'warning' | 'info';
  message: string;
}

export function deriveRecorderNotices(snapshot: RecorderSnapshot): RecorderNotice[] {
  const notices: RecorderNotice[] = [];
  const capabilities = snapshot.capabilities;

  if (!capabilities.supported) {
    return [{ tone: 'error', message: 'This recorder is only available on Android and iOS.' }];
  }
  if (!capabilities.taskManagerAvailable) {
    notices.push({
      tone: 'error',
      message: 'Background tasks are unavailable. Install and open the development build, not Expo Go.',
    });
  }
  if (!capabilities.locationServicesEnabled) {
    notices.push({ tone: 'error', message: 'Device location services are disabled.' });
  }
  if (capabilities.foregroundPermission === 'denied') {
    notices.push({ tone: 'error', message: 'Precise foreground location permission was denied.' });
  }
  if (capabilities.backgroundPermission === 'denied') {
    notices.push({ tone: 'error', message: 'Background location permission was denied.' });
  }
  if (!capabilities.pressureAvailable) {
    notices.push({
      tone: 'warning',
      message: 'No barometer is available. GPS can still be tested; pressure samples will be absent.',
    });
  }
  if (!capabilities.sharingAvailable) {
    notices.push({
      tone: 'warning',
      message: 'The native share sheet is unavailable. Exports can be written but not shared here.',
    });
  }
  if (snapshot.batteryOptimizationEnabled) {
    notices.push({
      tone: 'warning',
      message: 'Android battery optimization is enabled and may affect locked-screen cadence.',
    });
  }
  if (snapshot.lastError) {
    notices.push({ tone: 'error', message: snapshot.lastError.message });
  }
  return notices;
}
