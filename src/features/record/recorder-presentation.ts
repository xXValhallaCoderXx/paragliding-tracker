import type { RecorderSnapshot } from '@/recorder/types';

import { formatBattery } from '@/lib/format/flight-format';

export type ReadinessTone = 'good' | 'warning' | 'danger' | 'neutral';
export type ReadinessLevel = 'ready' | 'degraded' | 'blocked';

export type ReadinessAction =
  | 'open_app_settings'
  | 'open_location_settings'
  | 'open_battery_settings';

export interface ReadinessRow {
  key: string;
  label: string;
  value: string;
  tone: ReadinessTone;
  /** Plain-language consequence, shown only when the row is not simply good. */
  detail: string | null;
  action: ReadinessAction | null;
}

export interface ReadinessSummary {
  level: ReadinessLevel;
  label: string;
  title: string;
  body: string;
}

export const LOW_BATTERY_LEVEL = 0.2;

type ReadinessInput = Pick<
  RecorderSnapshot,
  'capabilities' | 'batteryLevel' | 'batteryOptimizationEnabled'
>;

/**
 * Pre-flight readiness rows derived from the recorder snapshot. Nothing here
 * watches the GPS before recording starts: the recorder deliberately never
 * runs a foreground location subscription, so fix quality is only known once
 * recording begins.
 */
export function readinessRows(snapshot: ReadinessInput): ReadinessRow[] {
  const { capabilities } = snapshot;
  const rows: ReadinessRow[] = [];

  if (!capabilities.taskManagerAvailable) {
    rows.push({
      key: 'background',
      label: 'Background recording',
      value: 'unavailable',
      tone: 'danger',
      detail: 'Background tasks are unavailable here. Open the installed build, not Expo Go.',
      action: null,
    });
  }

  rows.push(
    capabilities.locationServicesEnabled
      ? {
          key: 'location',
          label: 'Location',
          value: capabilities.gpsAvailable === false ? 'on · no GPS provider' : 'on',
          tone: capabilities.gpsAvailable === false ? 'warning' : 'good',
          detail:
            capabilities.gpsAvailable === false
              ? 'This phone reports no GPS provider, so fixes may not arrive.'
              : null,
          action: null,
        }
      : {
          key: 'location',
          label: 'Location',
          value: 'off',
          tone: 'danger',
          detail: 'Turn on Location in Android settings before starting.',
          action: 'open_location_settings',
        },
  );

  rows.push(permissionRow('precise', 'Location · precise', capabilities.foregroundPermission));
  rows.push(
    permissionRow('always', 'Location · allow all the time', capabilities.backgroundPermission),
  );

  rows.push(
    capabilities.pressureAvailable
      ? {
          key: 'barometer',
          label: 'Barometer',
          value: 'on board · 1 Hz',
          tone: 'good',
          detail: null,
          action: null,
        }
      : {
          key: 'barometer',
          label: 'Barometer',
          value: 'none',
          tone: 'warning',
          detail:
            'Altitude comes from GPS only, and no pressure samples are stored alongside this flight.',
          action: null,
        },
  );

  const battery = formatBattery(snapshot.batteryLevel);
  if (battery !== null || snapshot.batteryOptimizationEnabled !== null) {
    const low = snapshot.batteryLevel !== null && snapshot.batteryLevel < LOW_BATTERY_LEVEL;
    const optimised = snapshot.batteryOptimizationEnabled === true;
    const details: string[] = [];
    if (low) {
      details.push(
        'The track is saved to the phone continuously, so a flat battery keeps everything recorded up to that point.',
      );
    }
    if (optimised) {
      details.push(
        'Android battery optimization is on and may pause a long locked-screen flight. Excluding this app helps.',
      );
    }
    rows.push({
      key: 'battery',
      label: 'Battery',
      value: [battery ?? '—', optimised ? 'optimization on' : null].filter(Boolean).join(' · '),
      tone: low || optimised ? 'warning' : 'good',
      detail: details.length > 0 ? details.join(' ') : null,
      action: optimised ? 'open_battery_settings' : null,
    });
  }

  return rows;
}

function permissionRow(
  key: string,
  label: string,
  permission: RecorderSnapshot['capabilities']['foregroundPermission'],
): ReadinessRow {
  switch (permission) {
    case 'granted':
      return { key, label, value: 'granted', tone: 'good', detail: null, action: null };
    case 'denied':
      return {
        key,
        label,
        value: 'DENIED',
        tone: 'danger',
        detail:
          key === 'always'
            ? 'Without “allow all the time” the track stops the moment the screen locks.'
            : 'Precise location is required to record a track.',
        action: 'open_app_settings',
      };
    default:
      return {
        key,
        label,
        value: 'not asked yet',
        tone: 'neutral',
        detail: 'Android will ask when you press start.',
        action: null,
      };
  }
}

export function readinessSummary(rows: ReadinessRow[]): ReadinessSummary {
  const blocked = rows.some((row) => row.tone === 'danger');
  const degraded = rows.filter((row) => row.tone === 'warning').length;
  if (blocked) {
    const permissionDenied = rows.some(
      (row) => row.tone === 'danger' && row.action === 'open_app_settings',
    );
    return {
      level: 'blocked',
      label: "CAN'T RECORD YET",
      title: permissionDenied
        ? 'Android needs to let this app follow you.'
        : 'Something needs switching on first.',
      body: permissionDenied
        ? 'Location has to stay on while the screen is off, otherwise the track stops the moment you pocket the phone.'
        : 'Fix the item marked below, then come back — the recorder checks again on its own.',
    };
  }
  if (degraded > 0) {
    return {
      level: 'degraded',
      label: degraded === 1 ? 'ONE THING TO KNOW' : `${numberWord(degraded)} THINGS TO KNOW`,
      title: 'You can still fly this.',
      body: 'It will record — here is exactly what changes.',
    };
  }
  return {
    level: 'ready',
    label: 'ALL GOOD',
    title: 'Ready when you are.',
    body: 'Location is on, permissions are granted, and the track is saved as it comes in.',
  };
}

function numberWord(count: number): string {
  const words = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX'];
  return words[count] ?? String(count);
}

export interface InFlightNotice {
  key: string;
  tone: 'warning' | 'danger' | 'info';
  title: string;
  body: string;
}

/**
 * Degraded-state cards shown while a flight is open. Health-related copy is
 * intentionally factual: recording continues to persist fixes only when the
 * native task is registered and callbacks keep arriving. Battery optimization
 * and the missing barometer are pre-flight facts (see `readinessRows`); in
 * flight the altitude label carries a NO BAROMETER tag instead of a card.
 */
export function inFlightNotices(
  snapshot: Pick<
    RecorderSnapshot,
    | 'state'
    | 'captureHealth'
    | 'capturedAt'
    | 'lastFixReceivedAt'
    | 'lastLocationCallbackAt'
    | 'batteryLevel'
    | 'batteryOptimizationEnabled'
    | 'lastError'
    | 'capabilities'
  >,
): InFlightNotice[] {
  const notices: InFlightNotice[] = [];
  const battery = formatBattery(snapshot.batteryLevel);

  if (snapshot.state === 'recording' && snapshot.captureHealth === 'stale') {
    const ageSeconds =
      snapshot.lastFixReceivedAt === null
        ? null
        : Math.max(0, Math.round((snapshot.capturedAt - snapshot.lastFixReceivedAt) / 1000));
    notices.push({
      key: 'stale',
      tone: 'warning',
      title:
        ageSeconds === null ? 'No valid GPS fix yet' : `No valid GPS fix for ${ageSeconds} s`,
      body:
        'The recorder is still running, but nothing new is reaching the track. Keep the phone clear of your body and the harness; if the fix does not return, the recorder will try to restart GPS.',
    });
  }
  if (snapshot.captureHealth === 'recovering') {
    notices.push({
      key: 'recovering',
      tone: 'warning',
      title: 'Restarting GPS capture',
      body: 'Waiting for a fresh, valid fix within 20 seconds. Fixes already recorded are safe.',
    });
  }
  if (
    snapshot.state === 'recording' &&
    snapshot.captureHealth !== 'healthy' &&
    snapshot.captureHealth !== 'stale' &&
    snapshot.captureHealth !== 'recovering' &&
    snapshot.captureHealth !== 'starting'
  ) {
    notices.push({
      key: 'inactive',
      tone: 'danger',
      title: 'GPS capture is not running',
      body: 'The flight is open but the location task is not producing fixes. The recorder will try to recover it.',
    });
  }
  if (snapshot.batteryLevel !== null && snapshot.batteryLevel < LOW_BATTERY_LEVEL) {
    notices.push({
      key: 'battery',
      tone: 'warning',
      title: `Battery ${battery ?? 'low'}`,
      body: 'The flight is saved to the phone continuously, so a flat battery keeps everything recorded up to that point.',
    });
  }
  if (snapshot.lastError) {
    notices.push({
      key: 'error',
      tone: 'danger',
      title: 'Recorder reported a problem',
      body: snapshot.lastError.message,
    });
  }
  return notices;
}
