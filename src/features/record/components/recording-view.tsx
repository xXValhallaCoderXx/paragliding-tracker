import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from 'expo-router';

import { BusyRow, Notice } from '@/components/ui';
import type { LiveCameraIntent } from '@/components/flight-map/types';
import { useGetLiveMapQuery } from '@/store/endpoints';
import type { RecorderSnapshot } from '@/recorder/types';
import {
  readRecordingViewIntent,
  rememberRecordingViewIntent,
  type RecordingViewMode,
} from '../recording-view-intent';
import { InstrumentView, type InstrumentViewProps } from './instrument';
import { LiveMap } from './live-map';

/** Keyed by session in RecordFlightScreen; only small view/camera intent survives an exit. */
export function RecordingView(props: InstrumentViewProps & { recovering: boolean }) {
  const { snapshot, recovering, busyLabel } = props;
  const sessionId = snapshot.sessionId ?? '';
  const [intent, setIntent] = useState(() => readRecordingViewIntent(sessionId));
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(() => AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (sessionId && snapshot.state !== 'completed' && snapshot.state !== 'stopping') {
      rememberRecordingViewIntent(sessionId, intent);
    }
  }, [intent, sessionId, snapshot.state]);

  const selectView = useCallback((view: RecordingViewMode) => {
    setIntent((previous) => ({ ...previous, view }));
  }, []);
  const changeCamera = useCallback((camera: LiveCameraIntent) => {
    setIntent((previous) => ({ ...previous, camera }));
  }, []);
  const canRead = Boolean(sessionId) && intent.view === 'map' && focused && foreground &&
    !recovering && !busyLabel && (snapshot.state === 'arming' || snapshot.state === 'recording');

  return <InstrumentView {...props} selectedView={intent.view} onSelectView={selectView}
    actionsDisabled={props.actionsDisabled || !focused || !foreground}
    mapContent={canRead ? <LiveMapContent key={sessionId} sessionId={sessionId} snapshot={snapshot}
      camera={intent.camera} onCameraChange={changeCamera} /> :
      <BusyRow label={recovering ? 'Checking recorder health…' : 'Map paused'} />} />;
}

/** Unmount the hook as well as the map so neither retains hidden trail arrays. */
function LiveMapContent({ sessionId, snapshot, camera, onCameraChange }: {
  sessionId: string;
  snapshot: RecorderSnapshot;
  camera: LiveCameraIntent;
  onCameraChange: (camera: LiveCameraIntent) => void;
}) {
  const { currentData: data } = useGetLiveMapQuery(sessionId);
  if (!data) return <BusyRow label="Opening recent trail…" />;
  if (data.sessionId !== sessionId) return <Notice title="Waiting for recorded position" />;
  // A committed batch may be newer than the latest snapshot. Both owners publish
  // wall time; use the newest observation without adding another UI clock.
  return <LiveMap data={data} now={Math.max(snapshot.capturedAt, data.observedAt)} captureHealth={snapshot.captureHealth}
    camera={camera} onCameraChange={onCameraChange} />;
}
