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
  beginSessionRecoveryAttempt,
  completeSession,
  confirmSessionRecoveryAttempt,
  createSession,
  getFinalSessionRecoveryAttempt,
  getFlightBySessionId,
  getLatestSession,
  getPendingSessionRecoveryAttempt,
  getSession,
  getPilotProfile,
  getSessionExportData,
  getSessionSnapshotMetrics,
  getUnfinishedSession,
  markSessionInterrupted,
  persistPressureSample,
  recordEvent,
  recordExport,
  requestSessionStop,
} from './database.native';
import { buildDiagnosticJson } from './diagnostics';
import { finalizeFlightForSession } from './flight-repository.native';
import { buildUnsignedIgc, selectExportEligibleFixes, type IgcPilotHeaders } from './igc';
import { locationTaskOptionsMatch } from './location-task-options';
import { LifecycleCoordinator } from './operation-queue';
import {
  deriveCaptureHealth,
  isAutomaticRecoveryEligible,
} from './recovery-policy';
import { resolveInterruptedFinalizationTimestamp } from './recovery';
import { transitionRecorderState } from './state-machine';
import {
  RecorderError,
  type ArtifactService,
  type CaptureHealth,
  type CaptureService,
  type ExportArtifact,
  type PowerReading,
  type RecorderCapabilities,
  type RecorderFailure,
  type RecorderFailureCode,
  type RecorderPermission,
  type RecorderService,
  type RecorderSnapshot,
  type RecorderState,
  type PendingSessionRecoveryAttempt,
  type SessionRecord,
  type SessionRecoveryKind,
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
    flightId: null,
    sessionId: null,
    startedAt: null,
    endedAt: null,
    lastFixAt: null,
    lastFixReceivedAt: null,
    lastLocationCallbackAt: null,
    captureHealth: 'inactive',
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

interface LocationTaskState {
  started: boolean;
  configurationMatches: boolean;
}

async function getLocationTaskState(): Promise<LocationTaskState> {
  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(
    () => false,
  );
  if (!started) return { started: false, configurationMatches: false };
  const options = await TaskManager.getTaskOptionsAsync(LOCATION_TASK_NAME).catch(() => null);
  return {
    started: true,
    configurationMatches: locationTaskOptionsMatch(options, Location.Accuracy.BestForNavigation),
  };
}

class NativeRecorderService implements RecorderService {
  private snapshot = initialSnapshot();
  private readonly listeners = new Set<(snapshot: RecorderSnapshot) => void>();
  private state: RecorderState = 'idle';
  private activeFlightId: string | null = null;
  private activeSessionId: string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private supervisorTimer: ReturnType<typeof setInterval> | null = null;
  private pressureSubscription: { remove(): void } | null = null;
  private lastPowerReading: PowerReading | null = null;
  private lastPowerPollAt = 0;
  private lastPowerEventAt = 0;
  private lastCapabilitiesPollAt = 0;
  private capabilitiesCache = unknownCapabilities();
  private readonly lifecycle = new LifecycleCoordinator();
  private stopOperation: Promise<void> | null = null;
  private captureHealthOverride: CaptureHealth | null = null;
  private captureStartingAt: number | null = null;

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

  arm(): Promise<{ flightId: string; sessionId: string }> {
    return this.runLifecycleOperation(() => this.armInternal());
  }

  private async armInternal(): Promise<{ flightId: string; sessionId: string }> {
    await this.recoverInternal();
    this.state = transitionRecorderState(this.state, 'arm');
    this.captureHealthOverride = 'starting';
    this.updateSnapshot({ state: this.state, captureHealth: 'starting', lastError: null });
    let createdSessionId: string | null = null;

    try {
      await this.ensurePermissions();
      const startedAt = Date.now();
      const sessionId = Crypto.randomUUID();
      const flightId = Crypto.randomUUID();
      const power = await readPower();
      await createSession({
        id: sessionId,
        flightId,
        startedAt,
        timezoneOffsetMinutes: new Date(startedAt).getTimezoneOffset(),
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
      this.activeFlightId = flightId;
      this.activeSessionId = sessionId;
      this.lastPowerReading = power;
      this.lastPowerEventAt = power.recordedAt;
      await recordEvent(sessionId, 'permissions_granted', startedAt, {
        foreground: 'precise',
        background: 'granted',
      });
      await recordEvent(sessionId, 'barometer_capability', startedAt, {
        available: this.capabilitiesCache.pressureAvailable,
      });
      await recordEvent(sessionId, 'power_reading', power.recordedAt, { ...power });
      this.captureStartingAt = await this.startLocationTask();
      await this.startPressureSampling();
      this.state = transitionRecorderState(this.state, 'arm_succeeded');
      this.captureHealthOverride = null;
      this.startSupervisor();
      await this.refreshSnapshot(undefined, true);
      return { flightId, sessionId };
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
      this.stopSupervisor();
      this.captureHealthOverride = null;
      this.captureStartingAt = null;
      this.updateSnapshot({
        state: this.state,
        captureHealth: this.state === 'interrupted' ? 'failed' : 'inactive',
        lastError: failure,
      });
      throw error;
    }
  }

  stop(): Promise<void> {
    if (this.stopOperation) return this.stopOperation;
    if (this.state === 'idle' || this.state === 'completed') return Promise.resolve();

    // Capture the user's boundary synchronously at the public call site. The
    // lifecycle queue may already be waiting for GPS recovery proof, but the Stop
    // claim must not wait behind that recovery or silently extend the flight.
    const requestedAt = Date.now();
    const operation = this.requestAndCompleteStop(requestedAt);
    this.stopOperation = operation;
    void operation.then(
      () => {
        if (this.stopOperation === operation) this.stopOperation = null;
      },
      () => {
        if (this.stopOperation === operation) this.stopOperation = null;
      },
    );
    return operation;
  }

  private async requestAndCompleteStop(requestedAt: number): Promise<void> {
    const sessionId = this.activeSessionId;
    if (!sessionId) {
      throw new RecorderError('session_not_found', 'No active session is available to stop.');
    }

    let canonicalStoppedAt: number;
    try {
      // This write intentionally bypasses the lifecycle FIFO. It is a terminal,
      // first-wins claim that also closes any persisted recovery attempt. Native
      // teardown remains queued below.
      canonicalStoppedAt = await requestSessionStop(sessionId, requestedAt);
    } catch (error) {
      // A failed claim must not touch the native recorder or overwrite whatever
      // state an in-flight recovery reached while the write was attempted.
      this.updateSnapshot({
        lastError: failureFrom(error, 'storage_error'),
      });
      throw error;
    }

    this.state = 'stopping';
    this.captureHealthOverride = null;
    this.captureStartingAt = null;
    this.stopSupervisor();
    this.updateSnapshot({ state: this.state, captureHealth: 'inactive', lastError: null });

    return this.runLifecycleOperation(async () => {
      // A recovery that was already running may have updated transient in-memory
      // state while it unwound. Reassert the durable terminal state before cleanup.
      this.state = 'stopping';
      this.captureHealthOverride = null;
      this.captureStartingAt = null;
      this.stopSupervisor();
      const session = await getSession(sessionId);
      if (
        !session ||
        session.manualStopAt === null ||
        session.manualStopAt !== canonicalStoppedAt
      ) {
        throw new RecorderError(
          'storage_error',
          'The durable Stop boundary could not be reopened for completion.',
        );
      }
      await this.completePendingSessionStop(session);
    });
  }

  recover(): Promise<RecorderSnapshot> {
    return this.runLifecycleOperation(() => this.recoverInternal());
  }

  private async recoverInternal(): Promise<RecorderSnapshot> {
    if (!SUPPORTED) {
      this.snapshot = initialSnapshot();
      this.snapshot.capabilities = unknownCapabilities();
      this.publish();
      return this.snapshot;
    }

    const [capabilities, taskState, unfinished] = await Promise.all([
      this.getCapabilities(),
      getLocationTaskState(),
      getUnfinishedSession(),
    ]);
    this.capabilitiesCache = capabilities;

    if (taskState.started && !taskState.configurationMatches) {
      await this.stopLocationTask().catch(() => undefined);
    }
    const taskRegistered = taskState.started && taskState.configurationMatches;

    let session = unfinished;
    if (!session) {
      this.stopPressureSampling();
      this.stopSupervisor();
      if (taskState.started) await this.stopLocationTask().catch(() => undefined);
      session = await getLatestSession();
      this.activeSessionId = session?.id ?? null;
      this.activeFlightId = session
        ? ((await getFlightBySessionId(session.id))?.id ?? session.id)
        : null;
      this.state = session?.status === 'completed' ? 'completed' : 'idle';
      this.captureHealthOverride = null;
      this.captureStartingAt = null;
      await this.refreshSnapshot(session ?? undefined, true);
      return this.snapshot;
    }

    this.activeSessionId = session.id;
    this.activeFlightId = (await getFlightBySessionId(session.id))?.id ?? session.id;

    // A durable Stop is terminal and takes precedence over interrupted-session
    // actions, task health, and every recovery attempt.
    if (session.manualStopAt !== null) {
      await this.completePendingSessionStop(session, taskState.started);
      return this.snapshot;
    }

    const pendingRecoveryAttempt = await getPendingSessionRecoveryAttempt(session.id);
    if (pendingRecoveryAttempt) {
      try {
        await this.reconcilePendingRecoveryAttempt(
          session,
          pendingRecoveryAttempt,
          taskRegistered,
        );
        session = (await getSession(session.id)) ?? session;
        this.state = 'recording';
        this.captureHealthOverride = null;
        this.captureStartingAt = null;
        this.updateSnapshot({ state: this.state, lastError: null });
        await this.startPressureSampling();
        this.startSupervisor();
      } catch (error) {
        await this.failSessionRecovery(session, error);
        session = (await getSession(session.id)) ?? session;
      }
      await this.refreshSnapshot(session, true);
      return this.snapshot;
    }

    if (session.status === 'interrupted') {
      if (taskState.started) await this.stopLocationTask().catch(() => undefined);
      this.stopPressureSampling();
      this.state = 'interrupted';
      this.stopSupervisor();
      this.captureHealthOverride = null;
      this.captureStartingAt = null;
      await this.refreshSnapshot(session, true);
      return this.snapshot;
    }

    this.state = 'recording';
    const metrics = await getSessionSnapshotMetrics(session.id);
    // Capture the observation time after reading persisted callback/fix evidence. A
    // headless callback can commit while these reads are in flight; using an earlier
    // timestamp would make that genuinely fresh evidence appear to come from the future.
    const now = Date.now();
    const health = deriveCaptureHealth({
      state: 'recording',
      startedAt: this.captureStartingAt ?? session.startedAt,
      taskRegistered,
      lastLocationCallbackAt: metrics.lastLocationCallbackAt,
      lastEligibleFixReceiptAt: metrics.latestEligibleFixReceiptAt,
      now,
      staleAfterMs: RECORDER_CONFIG.gpsStaleAfterMs,
    });
    if (health === 'healthy' || health === 'starting') {
      if (health === 'healthy') {
        this.captureStartingAt = null;
      }
      this.captureHealthOverride = null;
      this.updateSnapshot({ lastError: null });
      await this.startPressureSampling();
      this.startSupervisor();
      await this.refreshSnapshot(session, true);
      return this.snapshot;
    }

    const eligible = isAutomaticRecoveryEligible({
      startedAt: session.startedAt,
      lastEligibleFixSourceAt: metrics.latestEligibleFixSourceAt,
      now,
      maximumGapMs: RECORDER_CONFIG.automaticRecoveryMaxGapMs,
    });
    if (!eligible) {
      if (taskState.started) await this.stopLocationTask().catch(() => undefined);
      this.stopPressureSampling();
      this.stopSupervisor();
      await markSessionInterrupted(
        session.id,
        now,
        'GPS capture was stale for longer than the automatic recovery window.',
      );
      this.state = 'interrupted';
      this.captureHealthOverride = null;
      this.captureStartingAt = null;
      session = (await getSession(session.id)) ?? session;
      await this.refreshSnapshot(session, true);
      return this.snapshot;
    }

    try {
      await this.attemptSessionRecovery(session, 'automatic');
      session = (await getSession(session.id)) ?? session;
      this.state = 'recording';
      this.startSupervisor();
      this.captureHealthOverride = null;
      this.captureStartingAt = null;
      this.updateSnapshot({ state: this.state, lastError: null });
    } catch (error) {
      await this.failSessionRecovery(session, error);
      session = (await getSession(session.id)) ?? session;
    }

    await this.refreshSnapshot(session, true);
    return this.snapshot;
  }

  private async completePendingSessionStop(
    session: SessionRecord,
    taskMayBeStarted = true,
  ): Promise<void> {
    if (session.manualStopAt === null) {
      throw new RecorderError('invalid_transition', 'No durable manual stop is pending.');
    }

    this.state = 'stopping';
    this.captureHealthOverride = null;
    this.captureStartingAt = null;
    this.stopSupervisor();
    this.updateSnapshot({ state: this.state, captureHealth: 'inactive', lastError: null });

    let cleanupFailure: RecorderFailure | null = null;
    if (taskMayBeStarted) {
      try {
        await this.stopLocationTask();
      } catch (error) {
        cleanupFailure = failureFrom(error, 'task_error');
      }
    }
    this.stopPressureSampling();

    const power = await readPower();
    let evidenceFailure: RecorderFailure | null = null;
    try {
      await recordEvent(session.id, 'power_reading', power.recordedAt, { ...power });
    } catch (error) {
      evidenceFailure = failureFrom(error, 'storage_error');
    }

    try {
      await completeSession(session.id, session.manualStopAt, 'stopped', power);
    } catch (error) {
      const failure = failureFrom(error, 'storage_error');
      this.updateSnapshot({
        state: this.state,
        captureHealth: 'inactive',
        lastError: failure,
      });
      await this.refreshSnapshot(session, true).catch(() => undefined);
      throw error;
    }

    if (cleanupFailure) {
      try {
        await this.stopLocationTask();
        cleanupFailure = null;
      } catch {
        // The session is already closed; foreground recovery will retry removal.
      }
    }

    this.state = transitionRecorderState('stopping', 'stop_succeeded');
    this.activeSessionId = session.id;
    const metricsFailure = await this.finalizeFlightStats(session.id);
    await this.refreshSnapshot(undefined, true);
    const finalFailure = cleanupFailure ?? evidenceFailure ?? metricsFailure;
    if (finalFailure) this.updateSnapshot({ lastError: finalFailure });
  }

  private async reconcilePendingRecoveryAttempt(
    session: SessionRecord,
    attempt: PendingSessionRecoveryAttempt,
    taskRegistered: boolean,
  ): Promise<void> {
    if (attempt.sessionId !== session.id) {
      throw new RecorderError('storage_error', 'The pending GPS recovery belongs to another session.');
    }
    this.state = 'recording';
    this.captureHealthOverride = 'recovering';
    this.captureStartingAt = attempt.attemptStartedAt;
    this.updateSnapshot({ state: this.state, captureHealth: 'recovering', lastError: null });

    let resolvedAttempt = attempt;
    if (!resolvedAttempt.provingFix) {
      if (!taskRegistered) {
        const finalProof = await this.getFinalRecoveryAttemptProof(resolvedAttempt);
        if (finalProof) resolvedAttempt = finalProof;
      } else {
        const proof = await this.waitForRecoveryAttemptProof(resolvedAttempt);
        if (proof) resolvedAttempt = proof;
      }
    }
    if (!resolvedAttempt.provingFix) {
      throw new RecorderError(
        'task_error',
        taskRegistered
          ? `GPS did not produce a valid recovery fix before the persisted ${Math.round(
              RECORDER_CONFIG.reacquisitionTimeoutMs / 1000,
            )}-second deadline.`
          : 'The persisted GPS recovery lost its native location task before producing a valid fix.',
      );
    }

    await confirmSessionRecoveryAttempt(resolvedAttempt.attemptId, Date.now());
  }

  private async waitForRecoveryAttemptProof(
    attempt: PendingSessionRecoveryAttempt,
  ): Promise<PendingSessionRecoveryAttempt | null> {
    let current = attempt;
    while (!current.provingFix) {
      const remainingMs = current.deadlineAt - Date.now();
      if (remainingMs <= 0) break;
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.min(RECORDER_CONFIG.reacquisitionPollIntervalMs, remainingMs)),
      );
      const refreshed = await getPendingSessionRecoveryAttempt(current.sessionId);
      if (!refreshed || refreshed.attemptId !== current.attemptId) {
        throw new RecorderError(
          'storage_error',
          'The persisted GPS recovery attempt changed while it was being observed.',
        );
      }
      current = refreshed;
    }
    if (current.provingFix) return current;

    return this.getFinalRecoveryAttemptProof(current);
  }

  private async getFinalRecoveryAttemptProof(
    attempt: PendingSessionRecoveryAttempt,
  ): Promise<PendingSessionRecoveryAttempt | null> {
    // This read is serialized behind the location write tail. It catches a callback
    // received before the deadline whose executor was still entering the shared write
    // queue at the edge. The proof query itself rejects receipts after the deadline.
    await new Promise<void>((resolve) =>
      setTimeout(resolve, RECORDER_CONFIG.reacquisitionPollIntervalMs),
    );
    const finalAttempt = await getFinalSessionRecoveryAttempt(attempt.attemptId);
    return finalAttempt?.provingFix ? finalAttempt : null;
  }

  resume(sessionId: string): Promise<void> {
    return this.runLifecycleOperation(() => this.resumeInternal(sessionId));
  }

  private async resumeInternal(sessionId: string): Promise<void> {
    await this.recoverInternal();
    const session = await getSession(sessionId);
    if (!session) throw new RecorderError('session_not_found', `Session ${sessionId} was not found.`);
    if (session.status === 'recording') return;
    if (session.status !== 'interrupted' || this.state !== 'interrupted') {
      throw new RecorderError('invalid_transition', 'Only an interrupted session can be resumed.');
    }
    this.state = transitionRecorderState(this.state, 'resume');
    this.updateSnapshot({ state: this.state, captureHealth: 'recovering', lastError: null });
    try {
      this.activeSessionId = sessionId;
      this.activeFlightId = (await getFlightBySessionId(sessionId))?.id ?? sessionId;
      await this.attemptSessionRecovery(session, 'manual');
      this.state = transitionRecorderState(this.state, 'arm_succeeded');
      this.captureHealthOverride = null;
      this.startSupervisor();
      await this.refreshSnapshot(undefined, true);
    } catch (error) {
      await this.failSessionRecovery(session, error);
      await this.refreshSnapshot(undefined, true).catch(() => undefined);
      throw error;
    }
  }

  finalizeInterrupted(sessionId: string): Promise<void> {
    return this.runLifecycleOperation(() => this.finalizeInterruptedInternal(sessionId));
  }

  private async finalizeInterruptedInternal(sessionId: string): Promise<void> {
    const session = await getSession(sessionId);
    if (!session) throw new RecorderError('session_not_found', `Session ${sessionId} was not found.`);
    if (session.status === 'completed') return;
    if (session.manualStopAt !== null) {
      await this.completePendingSessionStop(session);
      return;
    }
    if (session.status !== 'interrupted') {
      throw new RecorderError('invalid_transition', 'Only an interrupted session can be finalized as partial.');
    }
    const data = await getSessionExportData(sessionId);
    const interruptionObservedAt = Date.now();
    const fallbackAt = data.locations.reduce(
      (latest, fix) =>
        !fix.mocked &&
        Number.isFinite(fix.sourceTimestamp) &&
        fix.sourceTimestamp >= session.startedAt &&
        fix.sourceTimestamp <= interruptionObservedAt
          ? Math.max(latest, fix.sourceTimestamp)
          : latest,
      session.startedAt,
    );
    const finalizedAt = resolveInterruptedFinalizationTimestamp(
      session,
      data.events,
      fallbackAt,
    );
    if ((await getLocationTaskState()).started) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
    }
    this.stopPressureSampling();
    this.stopSupervisor();
    const power = await readPower();
    await recordEvent(sessionId, 'power_reading', power.recordedAt, { ...power });
    await completeSession(sessionId, finalizedAt, 'interrupted_finalized', power);
    this.captureStartingAt = null;
    this.state = transitionRecorderState('interrupted', 'finalize_interrupted');
    this.activeSessionId = sessionId;
    const metricsFailure = await this.finalizeFlightStats(sessionId);
    await this.refreshSnapshot(undefined, true);
    if (metricsFailure) this.updateSnapshot({ lastError: metricsFailure });
  }

  /**
   * The local pilot profile, or nothing if it has never been filled in.
   *
   * Read at export time rather than cached: the pilot may edit it between flights, and
   * a stale name in an IGC file is worse than an extra single-row query. A failure here
   * must never block an export, so it degrades to the historical placeholders.
   */
  private async pilotHeaders(): Promise<IgcPilotHeaders | undefined> {
    try {
      const profile = await getPilotProfile();
      return {
        pilotName: profile.pilotName,
        gliderType: profile.gliderType,
        gliderId: profile.gliderId,
      };
    } catch {
      return undefined;
    }
  }

  async exportIgc(sessionId: string): Promise<ExportArtifact> {
    try {
      const data = await getSessionExportData(sessionId);
      if (data.session.status === 'recording') {
        throw new RecorderError('export_error', 'Stop or finalize the session before exporting.');
      }
      const igc = buildUnsignedIgc(data.session, data.locations, await this.pilotHeaders());
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
      const eligibleFixes = selectExportEligibleFixes(data.locations, data.session);
      const igc =
        eligibleFixes.length > 0
          ? buildUnsignedIgc(data.session, data.locations, await this.pilotHeaders())
          : null;
      const content = buildDiagnosticJson(
        data,
        igc
          ? {
              available: true,
              sha256: await this.sha256(igc.content),
              byteCount: new TextEncoder().encode(igc.content).byteLength,
              bRecordCount: igc.bRecordCount,
            }
          : {
              available: false,
              sha256: null,
              byteCount: 0,
              bRecordCount: 0,
            },
      );
      return await this.writeArtifact(
        sessionId,
        'diagnostics',
        content,
        'json',
        eligibleFixes.length,
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
        const revision = this.lifecycle.revision;
        void this.refreshSnapshot().catch((error) => {
          if (revision !== this.lifecycle.revision || this.lifecycle.busy) return;
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

  private runLifecycleOperation<T>(operation: () => Promise<T>): Promise<T> {
    return this.lifecycle.run(operation);
  }

  private async finalizeFlightStats(sessionId: string): Promise<RecorderFailure | null> {
    try {
      const flight = await finalizeFlightForSession(sessionId);
      this.activeFlightId = flight.id;
      return null;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        code: 'storage_error',
        message: `The flight is safely saved. Its stats will be retried: ${detail}`,
        occurredAt: Date.now(),
      };
    }
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
    const granted = await this.requestLocationPermissions();
    if (granted.foregroundPermission !== 'granted') {
      throw new RecorderError(
        'foreground_permission_denied',
        'Precise foreground location permission is required.',
      );
    }
    if (granted.backgroundPermission !== 'granted') {
      throw new RecorderError(
        'background_permission_denied',
        'Background location permission is required for locked-screen testing.',
      );
    }
  }

  /**
   * The permission prompts on their own, with no arming and no throwing.
   *
   * First-run setup needs to ask before the pilot is at launch — the worst possible
   * moment for Android's two-stage dialog — and then show them what they actually
   * granted. `ensurePermissions` layers the refusals on top for the arm path.
   *
   * Android only shows the background prompt once foreground is granted, so the order
   * here is load-bearing: asking for "allow all the time" first silently does nothing.
   */
  async requestLocationPermissions(): Promise<RecorderCapabilities> {
    if (!SUPPORTED) return this.getCapabilities();
    const foreground = await Location.requestForegroundPermissionsAsync().catch(() => null);
    if (foreground?.granted && precisePermission(foreground)) {
      await Location.requestBackgroundPermissionsAsync().catch(() => null);
    }
    // Re-probe rather than trusting the responses: the pilot may have changed things in
    // system settings instead, and getCapabilities() is what every readiness row and
    // snapshot renders from.
    return this.getCapabilities();
  }

  private async attemptSessionRecovery(
    session: SessionRecord,
    kind: SessionRecoveryKind,
  ): Promise<void> {
    this.captureHealthOverride = 'recovering';
    this.updateSnapshot({ captureHealth: 'recovering', lastError: null });
    await this.ensurePermissions();

    // Remove the old registration before fixing the persisted proof boundary. The
    // DB claim is queued behind any callback already writing, so only a fix from
    // the newly started task can have a sequence beyond its captured baseline.
    await this.stopLocationTask();
    const attemptStartedAt = Date.now();
    const attempt = await beginSessionRecoveryAttempt({
      attemptId: Crypto.randomUUID(),
      sessionId: session.id,
      kind,
      attemptStartedAt,
      deadlineAt: attemptStartedAt + RECORDER_CONFIG.reacquisitionTimeoutMs,
      maximumCachedFixAgeMs: RECORDER_CONFIG.reacquisitionMaxCachedFixAgeMs,
    });
    this.captureStartingAt = attempt.attemptStartedAt;
    await this.startLocationUpdates();
    await this.startPressureSampling();

    const proof = await this.waitForRecoveryAttemptProof({ ...attempt, provingFix: null });
    if (!proof) {
      throw new RecorderError(
        'task_error',
        `GPS did not produce a new valid fix before the persisted ${Math.round(
          RECORDER_CONFIG.reacquisitionTimeoutMs / 1000,
        )}-second deadline.`,
      );
    }
    await confirmSessionRecoveryAttempt(proof.attemptId, Date.now());
  }

  private async failSessionRecovery(session: SessionRecord, error: unknown): Promise<void> {
    await this.stopLocationTask().catch(() => undefined);
    this.stopPressureSampling();
    this.stopSupervisor();
    const failure = failureFrom(error, 'task_error');
    await markSessionInterrupted(
      session.id,
      failure.occurredAt,
      `GPS recovery failed: ${failure.message}`,
      { recoveryFailed: true },
    ).catch(() => undefined);
    this.state = 'interrupted';
    this.captureHealthOverride = null;
    this.captureStartingAt = null;
    this.updateSnapshot({ state: this.state, captureHealth: 'failed', lastError: failure });
  }

  private async startLocationTask(): Promise<number> {
    if ((await getLocationTaskState()).started) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
    }
    const startRequestedAt = Date.now();
    await this.startLocationUpdates();
    return startRequestedAt;
  }

  private async startLocationUpdates(): Promise<void> {
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
        notificationTitle: 'Flight Log Alpha is recording',
        notificationBody: 'Your flight track is being recorded.',
        notificationColor: '#F59E0B',
        killServiceOnDestroy: RECORDER_CONFIG.killServiceOnDestroy,
      },
    });
  }

  private async stopLocationTask(): Promise<void> {
    if ((await getLocationTaskState()).started) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
    }
  }

  private startSupervisor(): void {
    if (this.supervisorTimer) return;
    this.supervisorTimer = setInterval(() => {
      if (
        AppState.currentState !== 'active' ||
        this.state !== 'recording' ||
        this.lifecycle.busy
      ) {
        return;
      }
      void this.runLifecycleOperation(() => this.superviseCaptureInternal()).catch((error) => {
        if (this.state !== 'recording') return;
        this.updateSnapshot({ lastError: failureFrom(error, 'task_error') });
      });
    }, RECORDER_CONFIG.supervisorIntervalMs);
  }

  private stopSupervisor(): void {
    if (!this.supervisorTimer) return;
    clearInterval(this.supervisorTimer);
    this.supervisorTimer = null;
  }

  private async superviseCaptureInternal(): Promise<void> {
    if (this.state !== 'recording') return;
    const session = await getUnfinishedSession();
    if (!session || session.status !== 'recording') {
      await this.recoverInternal();
      return;
    }
    const powerCheckAt = Date.now();
    if (powerCheckAt - this.lastPowerEventAt >= RECORDER_CONFIG.powerPollIntervalMs) {
      const power = await readPower();
      await recordEvent(session.id, 'power_reading', power.recordedAt, { ...power });
      this.lastPowerReading = power;
      this.lastPowerPollAt = power.recordedAt;
      this.lastPowerEventAt = power.recordedAt;
    }
    const [taskState, metrics] = await Promise.all([
      getLocationTaskState(),
      getSessionSnapshotMetrics(session.id),
    ]);
    const observedAt = Date.now();
    const health = deriveCaptureHealth({
      state: 'recording',
      startedAt: this.captureStartingAt ?? session.startedAt,
      taskRegistered: taskState.started && taskState.configurationMatches,
      lastLocationCallbackAt: metrics.lastLocationCallbackAt,
      lastEligibleFixReceiptAt: metrics.latestEligibleFixReceiptAt,
      now: observedAt,
      staleAfterMs: RECORDER_CONFIG.gpsStaleAfterMs,
    });
    if (health === 'healthy') {
      this.captureStartingAt = null;
      return;
    }
    if (health === 'starting') return;
    await this.recoverInternal();
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

  private async refreshSnapshot(
    preloadedSession?: SessionRecord,
    allowWhileLifecycleBusy = false,
  ): Promise<void> {
    const revision = this.lifecycle.beginSnapshot(allowWhileLifecycleBusy);
    if (revision === null) return;
    const readStartedAt = Date.now();
    if (readStartedAt - this.lastCapabilitiesPollAt >= 15_000) {
      await this.getCapabilities();
    }
    const session =
      preloadedSession ??
      (this.activeSessionId ? await getSession(this.activeSessionId) : await getLatestSession());
    const taskState = await getLocationTaskState();
    const taskRegistered = taskState.started && taskState.configurationMatches;
    const currentSession = session ? await getSession(session.id) : null;
    const resolvedFlightId = currentSession
      ? (this.activeFlightId ??
        (await getFlightBySessionId(currentSession.id))?.id ??
        currentSession.id)
      : null;
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
          lastLocationCallbackAt: null,
          latestEligibleFixSourceAt: null,
          latestEligibleFixReceiptAt: null,
    };

    let power = this.lastPowerReading;
    if (readStartedAt - this.lastPowerPollAt >= RECORDER_CONFIG.powerPollIntervalMs) {
      power = await readPower();
    }
    if (!this.lifecycle.canCommitSnapshot(revision, allowWhileLifecycleBusy)) return;
    const capturedAt = Date.now();
    this.activeFlightId = resolvedFlightId;
    if (power !== this.lastPowerReading) {
      this.lastPowerReading = power;
      this.lastPowerPollAt = capturedAt;
    }
    const endTime = currentSession?.endedAt ?? capturedAt;
    const captureHealth = deriveCaptureHealth({
      state: this.state,
      startedAt: this.captureStartingAt ?? currentSession?.startedAt ?? null,
      taskRegistered,
      lastLocationCallbackAt: metrics.lastLocationCallbackAt,
      lastEligibleFixReceiptAt: metrics.latestEligibleFixReceiptAt,
      now: capturedAt,
      staleAfterMs: RECORDER_CONFIG.gpsStaleAfterMs,
      recovering: this.captureHealthOverride === 'recovering',
    });
    this.snapshot = {
      capturedAt,
      state: this.state,
      flightId: currentSession ? resolvedFlightId : null,
      sessionId: currentSession?.id ?? null,
      startedAt: currentSession?.startedAt ?? null,
      endedAt: currentSession?.endedAt ?? null,
      lastFixAt: metrics.latestEligibleFixSourceAt,
      lastFixReceivedAt: metrics.latestEligibleFixReceiptAt,
      lastLocationCallbackAt: metrics.lastLocationCallbackAt,
      captureHealth,
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
              occurredAt: metrics.taskErrorAt ?? capturedAt,
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

  /**
   * Publish a partial change to the snapshot.
   *
   * The 1 Hz poll calls refreshSnapshot with allowWhileLifecycleBusy = false, so every tick is
   * discarded for the whole duration of a lifecycle operation (see LifecycleCoordinator.
   * beginSnapshot). A partial publish during that window used to carry the previous
   * `capturedAt` and `durationMs` straight through, so the status could change — "Restarting GPS
   * capture" — while the airtime readout and the "last fix N s ago" evidence line stood still.
   *
   * Airtime is wall-clock, so it can be recomputed here from the session bounds the snapshot
   * already carries. An explicit value in `changes` always wins.
   */
  private updateSnapshot(changes: Partial<RecorderSnapshot>) {
    const next = { ...this.snapshot, ...changes };
    if (changes.capturedAt === undefined) {
      next.capturedAt = Date.now();
    }
    if (changes.durationMs === undefined && next.startedAt !== null) {
      next.durationMs = Math.max(0, (next.endedAt ?? next.capturedAt) - next.startedAt);
    }
    this.snapshot = next;
    this.publish();
  }

  private publish() {
    for (const listener of this.listeners) listener(this.snapshot);
  }
}

export const recorderService: RecorderService = new NativeRecorderService();
export const captureService: CaptureService = recorderService;
export const artifactService: ArtifactService = recorderService;
