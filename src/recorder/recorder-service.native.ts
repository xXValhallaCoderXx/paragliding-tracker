import { AppState, Platform, type AppStateStatus } from 'react-native';
import * as Battery from 'expo-battery';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import { Directory, File, Paths } from 'expo-file-system';
import * as Location from 'expo-location';
import { Barometer, type BarometerMeasurement } from 'expo-sensors';
import * as Sharing from 'expo-sharing';
import * as TaskManager from 'expo-task-manager';

import { LOCATION_TASK_NAME, RECORDER_CONFIG } from './config';
import {
  completeSession,
  createSession,
  getLatestSession,
  getSession,
  getSessionExportData,
  getSessionSnapshotMetrics,
  getUnfinishedSession,
  markSessionInterrupted,
  markSessionResumed,
  persistPressureSample,
  recordEvent,
  recordExport,
} from './database.native';
import { buildDiagnosticJson } from './diagnostics';
import { buildUnsignedIgc } from './igc';
import { decideRecovery } from './recovery';
import { transitionRecorderState } from './state-machine';
import {
  RecorderError,
  type ExportArtifact,
  type PowerReading,
  type RecorderCapabilities,
  type RecorderFailure,
  type RecorderFailureCode,
  type RecorderPermission,
  type RecorderService,
  type RecorderSnapshot,
  type RecorderState,
  type SessionRecord,
} from './types';

const SUPPORTED = Platform.OS === 'android' || Platform.OS === 'ios';

function permissionValue(
  status: Location.PermissionStatus,
  precise = true,
): RecorderPermission {
  if (status === Location.PermissionStatus.UNDETERMINED) return 'unknown';
  return status === Location.PermissionStatus.GRANTED && precise ? 'granted' : 'denied';
}

function unknownCapabilities(): RecorderCapabilities {
  return {
    platform: Platform.OS,
    supported: SUPPORTED,
    taskManagerAvailable: false,
    locationServicesEnabled: false,
    gpsAvailable: null,
    preciseLocation: false,
    pressureAvailable: false,
    batteryAvailable: false,
    sharingAvailable: false,
    foregroundPermission: 'unknown',
    backgroundPermission: 'unknown',
  };
}

function initialSnapshot(): RecorderSnapshot {
  return {
    capturedAt: Date.now(),
    state: 'idle',
    sessionId: null,
    startedAt: null,
    endedAt: null,
    lastFixAt: null,
    durationMs: 0,
    fixCount: 0,
    pressureCount: 0,
    gpsAltitude: null,
    speed: null,
    horizontalAccuracy: null,
    pressure: null,
    batteryLevel: null,
    lowPowerMode: null,
    batteryOptimizationEnabled: null,
    taskRegistered: false,
    capabilities: unknownCapabilities(),
    lastError: null,
  };
}

function failureFrom(error: unknown, fallbackCode: RecorderFailureCode): RecorderFailure {
  return {
    code: error instanceof RecorderError ? error.code : fallbackCode,
    message: error instanceof Error ? error.message : String(error),
    occurredAt: Date.now(),
  };
}

async function readPower(): Promise<PowerReading> {
  const recordedAt = Date.now();
  try {
    const available = await Battery.isAvailableAsync();
    if (!available) {
      return {
        batteryLevel: null,
        batteryState: null,
        lowPowerMode: null,
        batteryOptimizationEnabled: null,
        recordedAt,
      };
    }
    const [power, optimization] = await Promise.all([
      Battery.getPowerStateAsync(),
      Platform.OS === 'android'
        ? Battery.isBatteryOptimizationEnabledAsync().catch(() => null)
        : Promise.resolve(null),
    ]);
    return {
      batteryLevel: power.batteryLevel >= 0 ? power.batteryLevel : null,
      batteryState: power.batteryState,
      lowPowerMode: power.lowPowerMode,
      batteryOptimizationEnabled: optimization,
      recordedAt,
    };
  } catch {
    return {
      batteryLevel: null,
      batteryState: null,
      lowPowerMode: null,
      batteryOptimizationEnabled: null,
      recordedAt,
    };
  }
}

function precisePermission(response: Location.LocationPermissionResponse): boolean {
  if (Platform.OS === 'android') return response.android?.accuracy === 'fine';
  if (Platform.OS === 'ios') return response.ios?.accuracy !== 'reduced';
  return false;
}

class NativeRecorderService implements RecorderService {
  private snapshot = initialSnapshot();
  private readonly listeners = new Set<(snapshot: RecorderSnapshot) => void>();
  private state: RecorderState = 'idle';
  private activeSessionId: string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pressureSubscription: { remove(): void } | null = null;
  private lastPowerReading: PowerReading | null = null;
  private lastPowerPollAt = 0;
  private lastCapabilitiesPollAt = 0;
  private capabilitiesCache = unknownCapabilities();

  constructor() {
    AppState.addEventListener('change', (nextState) => {
      void this.handleAppStateChange(nextState);
    });
  }

  async getCapabilities(): Promise<RecorderCapabilities> {
    if (!SUPPORTED) return unknownCapabilities();
    const [
      taskManagerAvailable,
      provider,
      pressureAvailable,
      batteryAvailable,
      sharingAvailable,
      foreground,
      background,
    ] = await Promise.all([
      TaskManager.isAvailableAsync().catch(() => false),
      Location.getProviderStatusAsync().catch(() => null),
      Barometer.isAvailableAsync().catch(() => false),
      Battery.isAvailableAsync().catch(() => false),
      Sharing.isAvailableAsync().catch(() => false),
      Location.getForegroundPermissionsAsync(),
      Location.getBackgroundPermissionsAsync(),
    ]);
    const precise = foreground.granted && precisePermission(foreground);
    this.capabilitiesCache = {
      platform: Platform.OS,
      supported: true,
      taskManagerAvailable,
      locationServicesEnabled: provider?.locationServicesEnabled ?? false,
      gpsAvailable: provider?.gpsAvailable ?? null,
      preciseLocation: precise,
      pressureAvailable,
      batteryAvailable,
      sharingAvailable,
      foregroundPermission: permissionValue(foreground.status, precise),
      backgroundPermission: permissionValue(background.status),
    };
    this.lastCapabilitiesPollAt = Date.now();
    return this.capabilitiesCache;
  }

  async arm(): Promise<{ sessionId: string }> {
    await this.recover();
    this.state = transitionRecorderState(this.state, 'arm');
    this.updateSnapshot({ state: this.state, lastError: null });
    let createdSessionId: string | null = null;

    try {
      await this.ensurePermissions();
      const startedAt = Date.now();
      const sessionId = Crypto.randomUUID();
      const power = await readPower();
      await createSession({
        id: sessionId,
        startedAt,
        platform: Platform.OS,
        deviceMetadata: {
          brand: Device.brand,
          manufacturer: Device.manufacturer,
          modelName: Device.modelName,
          deviceName: Device.deviceName,
          osName: Device.osName,
          osVersion: Device.osVersion,
          deviceYearClass: Device.deviceYearClass,
          isDevice: Device.isDevice,
        },
        appMetadata: {
          applicationName: Constants.expoConfig?.name,
          version: Constants.expoConfig?.version,
          sdkVersion: Constants.expoConfig?.sdkVersion,
          runtimeVersion: Constants.expoConfig?.runtimeVersion,
        },
        startPower: power,
      });
      createdSessionId = sessionId;
      this.activeSessionId = sessionId;
      this.lastPowerReading = power;
      await recordEvent(sessionId, 'permissions_granted', startedAt, {
        foreground: 'precise',
        background: 'granted',
      });
      await recordEvent(sessionId, 'barometer_capability', startedAt, {
        available: this.capabilitiesCache.pressureAvailable,
      });
      await recordEvent(sessionId, 'power_reading', power.recordedAt, { ...power });
      await this.startLocationTask();
      await this.startPressureSampling();
      this.state = transitionRecorderState(this.state, 'arm_succeeded');
      await this.refreshSnapshot();
      return { sessionId };
    } catch (error) {
      const failure = failureFrom(error, 'task_error');
      if (createdSessionId) {
        await markSessionInterrupted(createdSessionId, failure.occurredAt, failure.message).catch(
          () => undefined,
        );
        this.state = 'interrupted';
      } else {
        this.state = transitionRecorderState(this.state, 'arm_failed');
      }
      this.updateSnapshot({ state: this.state, lastError: failure });
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.state === 'idle' || this.state === 'completed') return;
    if (this.state !== 'recording') {
      transitionRecorderState(this.state, 'stop');
      return;
    }
    this.state = transitionRecorderState(this.state, 'stop');
    this.updateSnapshot({ state: this.state, lastError: null });
    const sessionId = this.activeSessionId;
    if (!sessionId) {
      throw new RecorderError('session_not_found', 'No active session is available to stop.');
    }

    try {
      if (await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME)) {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
      }
      this.stopPressureSampling();
      const power = await readPower();
      await recordEvent(sessionId, 'power_reading', power.recordedAt, { ...power });
      await completeSession(sessionId, Date.now(), 'stopped', power);
      this.state = transitionRecorderState(this.state, 'stop_succeeded');
      await this.refreshSnapshot();
    } catch (error) {
      const taskRegistered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME).catch(
        () => false,
      );
      if (taskRegistered) {
        this.state = 'recording';
      } else {
        await markSessionInterrupted(sessionId, Date.now(), 'Stop did not complete cleanly.').catch(
          () => undefined,
        );
        this.state = 'interrupted';
      }
      this.updateSnapshot({
        state: this.state,
        lastError: failureFrom(error, 'task_error'),
      });
      throw error;
    }
  }

  async recover(): Promise<RecorderSnapshot> {
    if (!SUPPORTED) {
      this.snapshot = initialSnapshot();
      this.snapshot.capabilities = unknownCapabilities();
      this.publish();
      return this.snapshot;
    }

    const [capabilities, taskRegistered, unfinished] = await Promise.all([
      this.getCapabilities(),
      TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME).catch(() => false),
      getUnfinishedSession(),
    ]);
    this.capabilitiesCache = capabilities;

    let session = unfinished;
    const recovery = decideRecovery(session?.status ?? null, taskRegistered);
    if (session && recovery.action === 'mark_interrupted') {
      await markSessionInterrupted(session.id, Date.now(), 'Location task was not registered on recovery.');
      session = await getSession(session.id);
    } else if (session && recovery.action === 'mark_resumed') {
      await markSessionResumed(session.id, Date.now());
      session = await getSession(session.id);
    }

    if (session) {
      this.activeSessionId = session.id;
      this.state = session.status === 'recording' ? 'recording' : 'interrupted';
      if (this.state === 'recording') await this.startPressureSampling();
    } else {
      this.stopPressureSampling();
      if (recovery.action === 'stop_stale_task') {
        await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => undefined);
      }
      session = await getLatestSession();
      this.activeSessionId = session?.id ?? null;
      this.state = session?.status === 'completed' ? 'completed' : 'idle';
    }

    await this.refreshSnapshot(session ?? undefined);
    return this.snapshot;
  }

  async resume(sessionId: string): Promise<void> {
    await this.recover();
    const session = await getSession(sessionId);
    if (!session) throw new RecorderError('session_not_found', `Session ${sessionId} was not found.`);
    if (session.status === 'recording') return;
    if (session.status !== 'interrupted' || this.state !== 'interrupted') {
      throw new RecorderError('invalid_transition', 'Only an interrupted session can be resumed.');
    }
    this.state = transitionRecorderState(this.state, 'resume');
    this.updateSnapshot({ state: this.state, lastError: null });
    try {
      await this.ensurePermissions();
      await markSessionResumed(sessionId, Date.now());
      this.activeSessionId = sessionId;
      await this.startLocationTask();
      await this.startPressureSampling();
      this.state = transitionRecorderState(this.state, 'arm_succeeded');
      await this.refreshSnapshot();
    } catch (error) {
      await markSessionInterrupted(sessionId, Date.now(), 'Resume failed before task registration.').catch(
        () => undefined,
      );
      this.state = 'interrupted';
      this.updateSnapshot({ state: this.state, lastError: failureFrom(error, 'task_error') });
      throw error;
    }
  }

  async finalizeInterrupted(sessionId: string): Promise<void> {
    const session = await getSession(sessionId);
    if (!session) throw new RecorderError('session_not_found', `Session ${sessionId} was not found.`);
    if (session.status === 'completed') return;
    if (session.status !== 'interrupted') {
      throw new RecorderError('invalid_transition', 'Only an interrupted session can be finalized as partial.');
    }
    if (await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME).catch(() => false)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
    }
    this.stopPressureSampling();
    const power = await readPower();
    await recordEvent(sessionId, 'power_reading', power.recordedAt, { ...power });
    await completeSession(sessionId, Date.now(), 'interrupted_finalized', power);
    this.state = transitionRecorderState('interrupted', 'finalize_interrupted');
    this.activeSessionId = sessionId;
    await this.refreshSnapshot();
  }

  async exportIgc(sessionId: string): Promise<ExportArtifact> {
    try {
      const data = await getSessionExportData(sessionId);
      if (data.session.status === 'recording') {
        throw new RecorderError('export_error', 'Stop or finalize the session before exporting.');
      }
      const igc = buildUnsignedIgc(data.session, data.locations);
      return await this.writeArtifact(
        sessionId,
        'igc',
        igc.content,
        'igc',
        igc.eligibleFixes.length,
        RECORDER_CONFIG.igcArtifactVersion,
      );
    } catch (error) {
      this.updateSnapshot({ lastError: failureFrom(error, 'export_error') });
      throw error;
    }
  }

  async exportDiagnostics(sessionId: string): Promise<ExportArtifact> {
    try {
      const data = await getSessionExportData(sessionId);
      if (data.session.status === 'recording') {
        throw new RecorderError('export_error', 'Stop or finalize the session before exporting.');
      }
      const igc = buildUnsignedIgc(data.session, data.locations);
      const igcHash = await this.sha256(igc.content);
      const content = buildDiagnosticJson(data, {
        sha256: igcHash,
        byteCount: new TextEncoder().encode(igc.content).byteLength,
        bRecordCount: igc.bRecordCount,
      });
      return await this.writeArtifact(
        sessionId,
        'diagnostics',
        content,
        'json',
        igc.eligibleFixes.length,
        RECORDER_CONFIG.diagnosticsArtifactVersion,
      );
    } catch (error) {
      this.updateSnapshot({ lastError: failureFrom(error, 'export_error') });
      throw error;
    }
  }

  async shareArtifact(artifact: ExportArtifact): Promise<void> {
    if (!(await Sharing.isAvailableAsync())) {
      const error = new RecorderError(
        'share_unavailable',
        'The native share sheet is unavailable on this device.',
      );
      this.updateSnapshot({ lastError: failureFrom(error, 'share_unavailable') });
      throw error;
    }
    await Sharing.shareAsync(artifact.uri, {
      dialogTitle: artifact.kind === 'igc' ? 'Share unsigned IGC' : 'Share diagnostics',
      mimeType: artifact.kind === 'igc' ? 'application/vnd.fai.igc' : 'application/json',
      UTI: artifact.kind === 'igc' ? 'public.data' : 'public.json',
    });
  }

  subscribe(listener: (snapshot: RecorderSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => {
        void this.refreshSnapshot().catch((error) => {
          this.updateSnapshot({ lastError: failureFrom(error, 'storage_error') });
        });
      }, RECORDER_CONFIG.snapshotPollIntervalMs);
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
    };
  }

  private async ensurePermissions(): Promise<void> {
    if (!SUPPORTED) {
      throw new RecorderError('unsupported_platform', 'Recording is unavailable on this platform.');
    }
    if (!(await TaskManager.isAvailableAsync())) {
      throw new RecorderError(
        'task_manager_unavailable',
        'Background tasks are unavailable. Use an installed development build, not Expo Go.',
      );
    }
    if (!(await Location.hasServicesEnabledAsync())) {
      throw new RecorderError('location_disabled', 'Enable device location services before arming.');
    }
    const foreground = await Location.requestForegroundPermissionsAsync();
    if (!foreground.granted || !precisePermission(foreground)) {
      throw new RecorderError(
        'foreground_permission_denied',
        'Precise foreground location permission is required.',
      );
    }
    const background = await Location.requestBackgroundPermissionsAsync();
    if (!background.granted) {
      throw new RecorderError(
        'background_permission_denied',
        'Background location permission is required for locked-screen testing.',
      );
    }
    await this.getCapabilities();
  }

  private async startLocationTask(): Promise<void> {
    if (await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
    }
    await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: RECORDER_CONFIG.androidTimeIntervalMs,
      distanceInterval: RECORDER_CONFIG.distanceIntervalMetres,
      deferredUpdatesDistance: RECORDER_CONFIG.deferredUpdatesDistanceMetres,
      deferredUpdatesInterval: RECORDER_CONFIG.deferredUpdatesIntervalMs,
      deferredUpdatesTimeout: RECORDER_CONFIG.deferredUpdatesTimeoutMs,
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.Airborne,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'XC Recorder Lab is recording',
        notificationBody: 'Diagnostic flight track capture is active.',
        notificationColor: '#F59E0B',
        killServiceOnDestroy: RECORDER_CONFIG.killServiceOnDestroy,
      },
    });
  }

  private async startPressureSampling(): Promise<void> {
    if (this.pressureSubscription) return;
    if (!(await Barometer.isAvailableAsync().catch(() => false))) return;
    Barometer.setUpdateInterval(RECORDER_CONFIG.barometerIntervalMs);
    this.pressureSubscription = Barometer.addListener((measurement: BarometerMeasurement) => {
      const receivedAt = Date.now();
      void persistPressureSample({
        nativeTimestamp: measurement.timestamp,
        receivedAt,
        pressure: measurement.pressure,
        relativeAltitude: measurement.relativeAltitude ?? null,
      }).catch((error) => {
        this.updateSnapshot({ lastError: failureFrom(error, 'storage_error') });
      });
    });
  }

  private stopPressureSampling() {
    this.pressureSubscription?.remove();
    this.pressureSubscription = null;
  }

  private async handleAppStateChange(nextState: AppStateStatus): Promise<void> {
    const sessionId = this.activeSessionId;
    if (!sessionId || (this.state !== 'recording' && this.state !== 'interrupted')) return;
    await recordEvent(sessionId, 'app_state_change', Date.now(), { state: nextState }).catch(
      () => undefined,
    );
  }

  private async refreshSnapshot(preloadedSession?: SessionRecord): Promise<void> {
    const now = Date.now();
    if (now - this.lastCapabilitiesPollAt >= 15_000) {
      await this.getCapabilities();
    }
    const session =
      preloadedSession ??
      (this.activeSessionId ? await getSession(this.activeSessionId) : await getLatestSession());
    const taskRegistered = await TaskManager.isTaskRegisteredAsync(LOCATION_TASK_NAME).catch(
      () => false,
    );
    if (session?.status === 'recording' && !taskRegistered && this.state === 'recording') {
      await markSessionInterrupted(session.id, now, 'Location task disappeared while the app was running.');
      this.state = transitionRecorderState(this.state, 'task_missing');
    }
    const currentSession = session ? await getSession(session.id) : null;
    const metrics = currentSession
      ? await getSessionSnapshotMetrics(currentSession.id)
      : {
          fixCount: 0,
          pressureCount: 0,
          gpsAltitude: null,
          speed: null,
          horizontalAccuracy: null,
          pressure: null,
          taskErrorMessage: null,
          taskErrorAt: null,
        };

    if (now - this.lastPowerPollAt >= RECORDER_CONFIG.powerPollIntervalMs) {
      this.lastPowerReading = await readPower();
      this.lastPowerPollAt = now;
      if (currentSession?.status === 'recording') {
        await recordEvent(
          currentSession.id,
          'power_reading',
          this.lastPowerReading.recordedAt,
          { ...this.lastPowerReading },
        );
      }
    }
    const power = this.lastPowerReading;
    const endTime = currentSession?.endedAt ?? now;
    this.snapshot = {
      capturedAt: now,
      state: this.state,
      sessionId: currentSession?.id ?? null,
      startedAt: currentSession?.startedAt ?? null,
      endedAt: currentSession?.endedAt ?? null,
      lastFixAt: currentSession?.lastFixAt ?? null,
      durationMs: currentSession ? Math.max(0, endTime - currentSession.startedAt) : 0,
      fixCount: metrics.fixCount,
      pressureCount: metrics.pressureCount,
      gpsAltitude: metrics.gpsAltitude,
      speed: metrics.speed,
      horizontalAccuracy: metrics.horizontalAccuracy,
      pressure: metrics.pressure,
      batteryLevel: power?.batteryLevel ?? null,
      lowPowerMode: power?.lowPowerMode ?? null,
      batteryOptimizationEnabled: power?.batteryOptimizationEnabled ?? null,
      taskRegistered,
      capabilities: this.capabilitiesCache,
      lastError:
        this.snapshot.lastError ??
        (metrics.taskErrorMessage
          ? {
              code: 'task_error',
              message: metrics.taskErrorMessage,
              occurredAt: metrics.taskErrorAt ?? now,
            }
          : null),
    };
    this.publish();
  }

  private async writeArtifact(
    sessionId: string,
    kind: ExportArtifact['kind'],
    content: string,
    extension: string,
    eligibleFixCount: number,
    artifactVersion: number,
  ): Promise<ExportArtifact> {
    const directory = new Directory(Paths.document, 'xc-recorder-exports');
    directory.create({ idempotent: true, intermediates: true });
    const safeSessionId = sessionId.replace(/[^a-z0-9-]/gi, '');
    const filename = `${safeSessionId}-v${artifactVersion}.${extension}`;
    const file = new File(directory, filename);
    file.create({ overwrite: true, intermediates: true });
    file.write(content);
    const artifact: ExportArtifact = {
      sessionId,
      kind,
      uri: file.uri,
      sha256: await this.sha256(content),
      byteCount: new TextEncoder().encode(content).byteLength,
      eligibleFixCount,
    };
    await recordExport(artifact, artifactVersion, Date.now());
    return artifact;
  }

  private sha256(content: string): Promise<string> {
    return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, content);
  }

  private updateSnapshot(changes: Partial<RecorderSnapshot>) {
    this.snapshot = { ...this.snapshot, ...changes };
    this.publish();
  }

  private publish() {
    for (const listener of this.listeners) listener(this.snapshot);
  }
}

export const recorderService: RecorderService = new NativeRecorderService();
