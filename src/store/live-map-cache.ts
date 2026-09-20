import {
  LIVE_MAP_MAX_ROWS,
  LIVE_MAP_POLL_MS,
  LIVE_MAP_WINDOW_MS,
  type CapturedMapFix,
  type LiveMapData,
  type LiveMapPage,
  type LiveMapRead,
} from '@/lib/live/types';

export function emptyLiveMap(sessionId: string): LiveMapData {
  return { sessionId, observedAt: Date.now(), rows: [], position: null, cursor: { sessionId, sequence: 0 }, readError: null };
}

function retainedRows(rows: CapturedMapFix[], sessionId: string, now: number): CapturedMapFix[] {
  const bySequence = new Map<number, CapturedMapFix>();
  for (const row of rows) {
    if (row.sessionId === sessionId && row.sourceTimestamp >= now - LIVE_MAP_WINDOW_MS &&
      row.sourceTimestamp <= now) bySequence.set(row.sequence, row);
  }
  return [...bySequence.values()].sort((left, right) => left.sequence - right.sequence).slice(-LIVE_MAP_MAX_ROWS);
}

type LoadPage = (input: LiveMapRead) => Promise<LiveMapPage>;

/** One bounded bootstrap replaces an oversized backlog; never walk all flight pages. */
async function nextLiveMap(load: LoadPage, previous: LiveMapData, bootstrap: boolean, active: () => boolean): Promise<LiveMapData> {
  const now = Date.now();
  let page = await load({ sessionId: previous.sessionId, now, ...(bootstrap ? {} : { cursor: previous.cursor }) });
  if (!active()) return previous;
  if (page.hasMore) page = await load({ sessionId: previous.sessionId, now });
  if (page.sessionId !== previous.sessionId || page.cursor.sessionId !== previous.sessionId || page.hasMore) {
    throw new Error('The map received an incomplete or unrelated recording page.');
  }
  const observedAt = Date.now();
  return {
    sessionId: previous.sessionId,
    observedAt,
    rows: retainedRows(page.mode === 'bootstrap' ? page.rows : [...previous.rows, ...page.rows], previous.sessionId, observedAt),
    position: page.position?.sessionId === previous.sessionId ? page.position : null,
    cursor: page.cursor,
    readError: null,
  };
}

/**
 * One awaited read sequence at a time. A timer starts only after it finishes, so slow
 * SQLite reads cannot accumulate. Closing ignores the outstanding result and frees
 * the timer; the owning RTK entry releases its evidence on unsubscription.
 */
export function startLiveMapPolling(options: {
  load: LoadPage;
  current: () => LiveMapData;
  publish: (data: LiveMapData) => void;
}): () => void {
  let closed = false;
  let bootstrap = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = async () => {
    const previous = options.current();
    try {
      const data = await nextLiveMap(options.load, previous, bootstrap, () => !closed);
      if (closed) return;
      bootstrap = false;
      options.publish(data);
    } catch (error) {
      if (closed) return;
      const observedAt = Date.now();
      options.publish({
        ...previous,
        observedAt,
        rows: retainedRows(previous.rows, previous.sessionId, observedAt),
        readError: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (!closed) timer = setTimeout(() => { void refresh(); }, LIVE_MAP_POLL_MS);
    }
  };
  void refresh();
  return () => {
    closed = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}

// Redux stores (including isolated test stores) own their own active map. A new session
// closes the previous worker before it starts; positions never carry across sessions.
export const activeLiveMapCaches = new WeakMap<object, { key: string; close: () => void }>();
