import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Platform } from 'react-native';
import * as ExpoLinking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { LoadingScreen, UnsupportedScreen } from '@/components/ui';
import { InstrumentView } from '@/features/record/components/instrument';
import { InterruptedView } from '@/features/record/components/interrupted';
import { PreflightView } from '@/features/record/components/preflight';
import { useRecorderLifecycle } from '@/features/record/recorder-lifecycle';
import { recorderService } from '@/recorder/recorder-service';
import type { RecorderSnapshot } from '@/recorder/types';
import { capturePresentation } from '@/features/record/capture-health';
import { inFlightNotices, type ReadinessAction } from '@/features/record/recorder-presentation';

type RecorderIntent = 'resume' | 'finalize';

/** States that render the in-flight instrument view rather than pre-flight or interrupted. */
const IN_FLIGHT_STATES: RecorderSnapshot['state'][] = ['arming', 'recording', 'stopping'];
const SAVING_FLIGHT_LABEL = 'Saving flight…';
const SAVING_PARTIAL_LABEL = 'Saving partial flight…';

export default function RecordFlightScreen() {
  const { intent } = useLocalSearchParams<{ intent?: string }>();
  const router = useRouter();
  const recorderLifecycle = useRecorderLifecycle();
  const [snapshot, setSnapshot] = useState<RecorderSnapshot | null>(null);
  const [activeFlightId, setActiveFlightId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const intentHandled = useRef(false);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let mounted = true;
    const unsubscribe = recorderService.subscribe((nextSnapshot) => {
      if (!mounted) return;
      setSnapshot(nextSnapshot);
      if (nextSnapshot.flightId) setActiveFlightId(nextSnapshot.flightId);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  const runAction = useCallback(async (label: string, action: () => Promise<void>) => {
    setBusy(label);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(messageFrom(error));
    } finally {
      setBusy(null);
    }
  }, []);

  const openFlight = useCallback(
    (flightId: string | null, saved: 'stopped' | 'partial') => {
      if (!flightId) {
        throw new Error('The flight was saved, but its logbook entry could not be opened.');
      }
      router.replace({ pathname: '/flights/[id]', params: { id: flightId, saved } });
    },
    [router],
  );

  const startRecording = useCallback(
    () =>
      runAction('Starting recorder…', async () => {
        const result = await recorderService.arm();
        setActiveFlightId(result.flightId);
      }),
    [runAction],
  );

  const finishRecording = useCallback(
    () =>
      runAction(SAVING_FLIGHT_LABEL, async () => {
        const knownFlightId = snapshot?.flightId ?? activeFlightId;
        await recorderService.stop();
        openFlight(knownFlightId, 'stopped');
      }),
    [activeFlightId, openFlight, runAction, snapshot?.flightId],
  );

  const resumeRecording = useCallback(
    (sessionId: string) =>
      runAction('Resuming recorder…', () => recorderService.resume(sessionId)),
    [runAction],
  );

  const finalizePartial = useCallback(
    (sessionId: string) =>
      runAction(SAVING_PARTIAL_LABEL, async () => {
        const knownFlightId = snapshot?.flightId ?? activeFlightId;
        await recorderService.finalizeInterrupted(sessionId);
        openFlight(knownFlightId, 'partial');
      }),
    [activeFlightId, openFlight, runAction, snapshot?.flightId],
  );

  const confirmFinalize = useCallback(
    (sessionId: string) => {
      Alert.alert(
        'Save as a partial flight?',
        'Only what was recorded before the interruption is kept. You cannot resume this flight afterwards.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Save partial', onPress: () => void finalizePartial(sessionId) },
        ],
      );
    },
    [finalizePartial],
  );

  // A pinned logbook card can hand over an explicit intent. Act on it exactly
  // once, and only while the recorder is genuinely interrupted.
  useEffect(() => {
    if (!snapshot || !recorderLifecycle.ready || recorderLifecycle.recovering) return;
    if (intentHandled.current) return;
    const requested = intent as RecorderIntent | undefined;
    const sessionId = snapshot.state === 'interrupted' ? snapshot.sessionId : null;
    // Deferred so the action runs after this render commits, never inside it.
    const timer = setTimeout(() => {
      if (intentHandled.current) return;
      intentHandled.current = true;
      if (!sessionId) return;
      if (requested === 'resume') void resumeRecording(sessionId);
      else if (requested === 'finalize') confirmFinalize(sessionId);
    }, 0);
    return () => clearTimeout(timer);
  }, [
    confirmFinalize,
    intent,
    recorderLifecycle.ready,
    recorderLifecycle.recovering,
    resumeRecording,
    snapshot,
  ]);

  const handleBack = useCallback(() => {
    if (snapshot?.state !== 'recording' && snapshot?.state !== 'arming') {
      goBack();
      return;
    }
    Alert.alert(
      'Recording continues',
      'You can go back to the logbook without stopping. Come back here when you have landed to stop and save.',
      [
        { text: 'Stay here', style: 'cancel' },
        { text: 'Back to logbook', onPress: goBack },
      ],
    );
  }, [goBack, snapshot?.state]);

  const handleReadinessAction = useCallback((action: ReadinessAction) => {
    void openSystemScreen(action).catch(() => undefined);
  }, []);

  const notices = useMemo(() => (snapshot ? inFlightNotices(snapshot) : []), [snapshot]);

  if (Platform.OS === 'web') return <UnsupportedScreen />;
  if (!snapshot || !recorderLifecycle.ready) {
    return <LoadingScreen label="Opening recorder…" />;
  }

  // Keep the current view on screen while a save is in flight, so the brief
  // "completed" snapshot before navigation never flashes the pre-flight screen.
  const savingStopped = busy === SAVING_FLIGHT_LABEL && snapshot.state === 'completed';
  const savingPartial = busy === SAVING_PARTIAL_LABEL && snapshot.state === 'completed';
  const showInterrupted = snapshot.state === 'interrupted' || savingPartial;
  // Which of the three recorder views to show. This used to double as the paper/night scheme
  // selector; the instrument mode is now paper like every other screen, so it only picks a view.
  const showInstrument =
    !showInterrupted && (IN_FLIGHT_STATES.includes(snapshot.state) || savingStopped);
  const actionsDisabled = Boolean(busy) || recorderLifecycle.recovering;
  const capture = savingStopped
    ? {
        label: 'SAVING',
        tone: 'neutral' as const,
        title: 'Saving your flight',
        description: 'The recorder is finishing the local track and flight stats.',
      }
    : capturePresentation(snapshot);

  let content;
  if (showInterrupted) {
    content = (
      <InterruptedView
        snapshot={snapshot}
        busyLabel={busy}
        actionsDisabled={actionsDisabled}
        recovering={recorderLifecycle.recovering}
        errorMessage={actionError}
        recoveryError={recorderLifecycle.recoveryError}
        onBack={handleBack}
        onResume={() => {
          if (snapshot.sessionId) void resumeRecording(snapshot.sessionId);
        }}
        onFinalize={() => {
          if (snapshot.sessionId) confirmFinalize(snapshot.sessionId);
        }}
      />
    );
  } else if (showInstrument) {
    content = (
      <InstrumentView
        snapshot={snapshot}
        capture={capture}
        notices={notices}
        busyLabel={busy}
        actionsDisabled={actionsDisabled}
        errorMessage={actionError}
        recoveryError={recorderLifecycle.recoveryError}
        onBack={handleBack}
        onStop={() => void finishRecording()}
        onRetrySave={() => void finishRecording()}
      />
    );
  } else {
    content = (
      <PreflightView
        snapshot={snapshot}
        busyLabel={busy}
        actionsDisabled={actionsDisabled}
        recovering={recorderLifecycle.recovering}
        errorMessage={actionError}
        recoveryError={recorderLifecycle.recoveryError}
        lastFlightId={snapshot.state === 'completed' ? (snapshot.flightId ?? activeFlightId) : null}
        onBack={handleBack}
        onStart={() => void startRecording()}
        onOpenLastFlight={(flightId) =>
          router.push({ pathname: '/flights/[id]', params: { id: flightId } })
        }
        onReadinessAction={handleReadinessAction}
      />
    );
  }

  return content;
}

async function openSystemScreen(action: ReadinessAction): Promise<void> {
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
    await ExpoLinking.openSettings();
  }
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
