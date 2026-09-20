/** Bounded, committed recorder evidence used only while the optional map is visible. */
export interface CapturedMapFix {
  sessionId: string;
  sequence: number;
  sourceTimestamp: number;
  receiptTimestamp: number;
  latitude: number;
  longitude: number;
  horizontalAccuracy: number | null;
  mocked: boolean;
}

export interface LiveMapCursor {
  sessionId: string;
  sequence: number;
}

export interface LiveMapData {
  sessionId: string;
  /** Wall time of this bounded read/prune publication; geometry follows this cadence. */
  observedAt: number;
  rows: CapturedMapFix[];
  position: CapturedMapFix | null;
  cursor: LiveMapCursor;
  readError: string | null;
}

export const LIVE_MAP_WINDOW_MS = 15 * 60_000;
/** Reserve one of the 1,000 retained rows for a last-known position outside the trail. */
export const LIVE_MAP_MAX_ROWS = 999;
export const LIVE_MAP_POLL_MS = 1_000;

export interface LiveMapRead {
  sessionId: string;
  cursor?: LiveMapCursor;
  now: number;
}

export interface LiveMapPage {
  sessionId: string;
  mode: 'bootstrap' | 'delta';
  rows: CapturedMapFix[];
  position: CapturedMapFix | null;
  cursor: LiveMapCursor;
  highWatermark: number;
  hasMore: boolean;
}
