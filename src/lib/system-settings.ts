import { Linking, Platform } from 'react-native';
import * as ExpoLinking from 'expo-linking';

import type { ReadinessAction } from '@/features/record/recorder-presentation';

/**
 * Deep links into the Android settings screens a pilot has to visit to unblock the
 * recorder.
 *
 * Lifted out of the record screen so first-run setup can offer the same escape hatch:
 * a permission denied during onboarding needs exactly the same route back as one denied
 * at launch, and duplicating the intent strings would let the two drift.
 *
 * Uses both linking modules on purpose — `sendIntent` is React Native's and is the only
 * way to reach a specific Android settings page, while `openSettings` is Expo's and is
 * the portable fallback for everything else.
 */
export async function openSystemScreen(action: ReadinessAction): Promise<void> {
  if (action === 'open_app_settings') {
    await ExpoLinking.openSettings();
    return;
  }
  if (Platform.OS !== 'android') {
    await ExpoLinking.openSettings();
    return;
  }
  const intentAction =
    action === 'open_location_settings'
      ? 'android.settings.LOCATION_SOURCE_SETTINGS'
      : 'android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS';
  try {
    await Linking.sendIntent(intentAction);
  } catch {
    // The intent is unavailable on some OEM builds. The app's own settings page always
    // exists and gets the pilot to the same permissions.
    await ExpoLinking.openSettings();
  }
}
