import type { LiveCameraIntent } from '@/components/flight-map/types';

export type RecordingViewMode = 'instruments' | 'map';
export interface RecordingViewIntent {
  view: RecordingViewMode;
  camera: LiveCameraIntent;
}

// One process-local session intent. Never retain fixes, geometry, queries or native views.
let retained: { sessionId: string; intent: RecordingViewIntent } | null = null;

export function readRecordingViewIntent(sessionId: string): RecordingViewIntent {
  if (retained?.sessionId === sessionId) return retained.intent;
  return { view: 'instruments', camera: { mode: 'follow', center: null, zoom: 14 } };
}

export function rememberRecordingViewIntent(sessionId: string, intent: RecordingViewIntent) {
  retained = { sessionId, intent };
}

export function clearRecordingViewIntent() {
  retained = null;
}
