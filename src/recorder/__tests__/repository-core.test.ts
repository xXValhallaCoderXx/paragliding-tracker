import {
  PENDING_SESSION_RECOVERY_ATTEMPT_SQL,
  SESSION_RECOVERY_ATTEMPT_BY_ID_SQL,
  beginSessionRecoveryAttemptTransaction,
  confirmSessionRecoveryAttemptTransaction,
  mapPendingSessionRecoveryAttemptRow,
  persistLocationBatchTransaction,
  requestSessionStopTransaction,
  resolveInterruptedPartialEndAt,
  resolveSessionCompletionTimestamp,
  type SqlExecutor,
  type TransactionalDatabase,
} from '../repository-core';
import type { SessionRecord } from '../types';

describe('interrupted persistence boundary', () => {
  it('uses the newest eligible fix within the session and interruption window', () => {
    expect(resolveInterruptedPartialEndAt(1000, 5000, 4000)).toBe(4000);
    expect(resolveInterruptedPartialEndAt(1000, 5000, 9000)).toBe(5000);
    expect(resolveInterruptedPartialEndAt(1000, 5000, 500)).toBe(1000);
    expect(resolveInterruptedPartialEndAt(1000, 5000, null)).toBe(1000);
  });
});

class FakeStopTransaction implements SqlExecutor {
  status: SessionRecord['status'] = 'recording';
  startedAt = 1000;
  manualStopAt: number | null = null;
  pendingRecovery = true;
  readonly events: { type: string; payload: unknown }[] = [];

  async getFirstAsync<T>(source: string): Promise<T | null> {
    if (source.includes('FROM sessions')) {
      return {
        status: this.status,
        started_at: this.startedAt,
        manual_stop_at: this.manualStopAt,
      } as T;
    }
    return null;
  }

  async runAsync(source: string, ...params: unknown[]) {
    if (source.includes('UPDATE sessions')) {
      this.status = 'interrupted';
      this.manualStopAt = Number(params[0]);
    }
    if (source.includes('UPDATE session_recovery_attempts')) this.pendingRecovery = false;
    if (source.includes("'manual_stop_requested'")) {
      this.events.push({ type: 'manual_stop_requested', payload: JSON.parse(String(params[3])) });
    }
    return { changes: 1 };
  }
}

describe('sticky manual stop persistence', () => {
  it('atomically closes capture and any recovery while preserving the first boundary', async () => {
    const transaction = new FakeStopTransaction();

    await expect(requestSessionStopTransaction(transaction, 'session-1', 2000)).resolves.toBe(2000);
    expect(transaction.status).toBe('interrupted');
    expect(transaction.manualStopAt).toBe(2000);
    expect(transaction.pendingRecovery).toBe(false);
    expect(transaction.events).toEqual([
      { type: 'manual_stop_requested', payload: { stoppedAt: 2000 } },
    ]);

    await expect(requestSessionStopTransaction(transaction, 'session-1', 9000)).resolves.toBe(2000);
    expect(transaction.events).toHaveLength(1);
  });

  it('accepts an interrupted race but rejects malformed boundaries and completed sessions', async () => {
    await expect(
      requestSessionStopTransaction(new FakeStopTransaction(), 'session-1', 999),
    ).rejects.toThrow('at or after the session start');
    const interrupted = new FakeStopTransaction();
    interrupted.status = 'interrupted';
    await expect(
      requestSessionStopTransaction(interrupted, 'session-1', 2000),
    ).resolves.toBe(2000);

    const completed = new FakeStopTransaction();
    completed.status = 'completed';
    await expect(
      requestSessionStopTransaction(completed, 'session-1', 2000),
    ).rejects.toThrow('Only an unfinished session');
  });

  it('makes the canonical Stop boundary win completion and rejects partial completion', () => {
    expect(resolveSessionCompletionTimestamp(1000, 9000, 2000, 'stopped')).toBe(2000);
    expect(resolveSessionCompletionTimestamp(1000, 9000, null, 'stopped')).toBe(9000);
    expect(() =>
      resolveSessionCompletionTimestamp(1000, 9000, 2000, 'interrupted_finalized'),
    ).toThrow('must complete with reason stopped');
  });
});

const attemptRow = (overrides: Record<string, unknown> = {}) => ({
  attempt_id: 'attempt-1',
  session_id: 'session-1',
  kind: 'automatic' as const,
  attempt_started_at: 2000,
  deadline_at: 22_000,
  maximum_cached_fix_age_ms: 5000,
  baseline_location_sequence: 7,
  proving_fix_sequence: null,
  proving_fix_source_at: null,
  proving_fix_receipt_at: null,
  ...overrides,
});

class FakeAttemptTransaction implements SqlExecutor {
  status: SessionRecord['status'] = 'recording';
  manualStopAt: number | null = null;
  locationSequence = 7;
  pendingRow: ReturnType<typeof attemptRow> | null = null;
  readonly events: { type: string; payload: Record<string, unknown> }[] = [];

  async getFirstAsync<T>(source: string): Promise<T | null> {
    if (source.includes('FROM sessions')) {
      return {
        status: this.status,
        started_at: 1000,
        location_sequence: this.locationSequence,
        manual_stop_at: this.manualStopAt,
      } as T;
    }
    if (source.includes('FROM session_recovery_attempts')) return this.pendingRow as T | null;
    return null;
  }

  async runAsync(source: string, ...params: unknown[]) {
    if (source.includes('INSERT INTO session_recovery_attempts')) {
      this.pendingRow = attemptRow({
        attempt_id: params[0],
        session_id: params[1],
        kind: params[2],
        attempt_started_at: params[3],
        deadline_at: params[4],
        maximum_cached_fix_age_ms: params[5],
        baseline_location_sequence: params[6],
      });
    }
    if (source.includes("outcome = 'succeeded'")) this.pendingRow = null;
    if (source.includes('INSERT INTO events')) {
      const type = source.match(/VALUES \(\?, '([^']+)'/)?.[1] ?? 'unknown';
      this.events.push({ type, payload: JSON.parse(String(params[3])) });
    }
    return { changes: 1 };
  }
}

describe('durable recovery attempt proof', () => {
  it('pins the exact sequence and time window in the proof query', () => {
    for (const sql of [PENDING_SESSION_RECOVERY_ATTEMPT_SQL, SESSION_RECOVERY_ATTEMPT_BY_ID_SQL]) {
      expect(sql).toContain('candidate.mocked = 0');
      expect(sql).toContain('candidate.sequence > attempt.baseline_location_sequence');
      expect(sql).toContain('candidate.receipt_timestamp >= attempt.attempt_started_at');
      expect(sql).toContain('candidate.receipt_timestamp <= attempt.deadline_at');
      expect(sql).toContain(
        'attempt.attempt_started_at - attempt.maximum_cached_fix_age_ms',
      );
      expect(sql).toContain('ORDER BY candidate.receipt_timestamp ASC, candidate.sequence ASC');
    }
  });

  it('captures the baseline and pairs confirmation to one proving fix and attempt ID', async () => {
    const transaction = new FakeAttemptTransaction();
    const attempt = await beginSessionRecoveryAttemptTransaction(transaction, {
      attemptId: 'attempt-1',
      sessionId: 'session-1',
      kind: 'automatic',
      attemptStartedAt: 2000,
      deadlineAt: 22_000,
      maximumCachedFixAgeMs: 5000,
    });
    expect(attempt.baselineLocationSequence).toBe(7);
    expect(transaction.events[0]).toMatchObject({
      type: 'recovery_attempt',
      payload: { attemptId: 'attempt-1', baselineLocationSequence: 7 },
    });

    transaction.pendingRow = attemptRow({
      proving_fix_sequence: 8,
      proving_fix_source_at: 1990,
      proving_fix_receipt_at: 2100,
    });
    const proof = await confirmSessionRecoveryAttemptTransaction(transaction, 'attempt-1', 2200);
    expect(proof).toMatchObject({
      attemptId: 'attempt-1',
      provingFix: { sequence: 8, sourceTimestamp: 1990, receiptTimestamp: 2100 },
      confirmedAt: 2200,
    });
    expect(transaction.events[1]).toMatchObject({
      type: 'recovery_succeeded',
      payload: { attemptId: 'attempt-1' },
    });
  });

  it('rejects a second pending attempt, a sticky Stop, and confirmation without proof', async () => {
    const pending = new FakeAttemptTransaction();
    pending.pendingRow = attemptRow();
    await expect(
      beginSessionRecoveryAttemptTransaction(pending, {
        attemptId: 'attempt-2',
        sessionId: 'session-1',
        kind: 'automatic',
        attemptStartedAt: 3000,
        deadlineAt: 23_000,
        maximumCachedFixAgeMs: 5000,
      }),
    ).rejects.toThrow('unmatched recovery attempt');

    const stopped = new FakeAttemptTransaction();
    stopped.status = 'interrupted';
    stopped.manualStopAt = 2500;
    await expect(
      beginSessionRecoveryAttemptTransaction(stopped, {
        attemptId: 'attempt-2',
        sessionId: 'session-1',
        kind: 'manual',
        attemptStartedAt: 3000,
        deadlineAt: 23_000,
        maximumCachedFixAgeMs: 5000,
      }),
    ).rejects.toThrow('pending manual stop');

    const noProof = new FakeAttemptTransaction();
    noProof.pendingRow = attemptRow();
    await expect(
      confirmSessionRecoveryAttemptTransaction(noProof, 'attempt-1', 3000),
    ).rejects.toThrow('does not have an eligible proving fix');
  });

  it('pairs manual success and session resume to the same attempt ID', async () => {
    const transaction = new FakeAttemptTransaction();
    transaction.status = 'interrupted';
    await beginSessionRecoveryAttemptTransaction(transaction, {
      attemptId: 'manual-attempt',
      sessionId: 'session-1',
      kind: 'manual',
      attemptStartedAt: 2000,
      deadlineAt: 22_000,
      maximumCachedFixAgeMs: 5000,
    });
    transaction.pendingRow = attemptRow({
      attempt_id: 'manual-attempt',
      kind: 'manual',
      proving_fix_sequence: 8,
      proving_fix_source_at: 2000,
      proving_fix_receipt_at: 2100,
    });

    await confirmSessionRecoveryAttemptTransaction(transaction, 'manual-attempt', 2200);

    expect(transaction.events.slice(1)).toEqual([
      expect.objectContaining({
        type: 'recovery_succeeded',
        payload: expect.objectContaining({ attemptId: 'manual-attempt', kind: 'manual' }),
      }),
      expect.objectContaining({
        type: 'session_resumed',
        payload: expect.objectContaining({ attemptId: 'manual-attempt', kind: 'manual' }),
      }),
    ]);
  });

  it('maps only all-null or same-row complete proof fields', () => {
    expect(mapPendingSessionRecoveryAttemptRow(attemptRow())?.provingFix).toBeNull();
    expect(
      mapPendingSessionRecoveryAttemptRow(
        attemptRow({
          proving_fix_sequence: 8,
          proving_fix_source_at: 1900,
          proving_fix_receipt_at: 2100,
        }),
      )?.provingFix,
    ).toEqual({ sequence: 8, sourceTimestamp: 1900, receiptTimestamp: 2100 });
    expect(() =>
      mapPendingSessionRecoveryAttemptRow(attemptRow({ proving_fix_sequence: 8 })),
    ).toThrow('incomplete proving fix');
  });
});

class FakeTransaction implements SqlExecutor {
  locationSequence = 0;
  readonly events = new Set<string>();
  readonly sourceKeys = new Set<string>();
  readonly inserted: unknown[][] = [];
  checkpoint: unknown[] | null = null;
  lastLocationCallbackAt: number | null = null;
  readonly heartbeatHistory: number[] = [];

  async getFirstAsync<T>(source: string, ...params: unknown[]): Promise<T | null> {
    if (source.includes('FROM sessions')) {
      return { id: 'session-1', location_sequence: this.locationSequence, started_at: 500 } as T;
    }
    if (source.includes('FROM events')) {
      return (params.slice(1).some((param) => this.events.has(String(param))) ? { id: 1 } : null) as
        | T
        | null;
    }
    return null;
  }

  async runAsync(source: string, ...params: unknown[]) {
    if (source.includes('INSERT OR IGNORE INTO location_fixes')) {
      const sourceKey = `${params[4]}:${params[6]}:${params[7]}`;
      if (this.sourceKeys.has(sourceKey)) return { changes: 0 };
      this.sourceKeys.add(sourceKey);
      this.inserted.push(params);
      this.locationSequence = Number(params[1]);
      return { changes: 1 };
    }
    if (source.includes('UPDATE sessions')) {
      if (source.includes('location_sequence')) this.checkpoint = params;
      if (source.includes('last_location_callback_at')) {
        const receivedAt = Number(source.includes('location_sequence') ? params[3] : params[0]);
        this.lastLocationCallbackAt = Math.max(
          this.lastLocationCallbackAt ?? receivedAt,
          receivedAt,
        );
        this.heartbeatHistory.push(this.lastLocationCallbackAt);
      }
    }
    if (source.includes("'location_callback'")) this.events.add(String(params[2]));
    return { changes: 1 };
  }
}

class FakeDatabase implements TransactionalDatabase {
  transactionCount = 0;
  readonly transaction = new FakeTransaction();

  async withExclusiveTransactionAsync(task: (transaction: SqlExecutor) => Promise<void>) {
    this.transactionCount += 1;
    await task(this.transaction);
  }
}

const validLocation = (timestamp: number, latitude: number) => ({
  timestamp,
  coords: {
    latitude,
    longitude: 103.8,
    altitude: 120,
    altitudeAccuracy: 5,
    accuracy: 4,
    speed: 8,
    heading: 30,
  },
});

describe('transactional callback persistence', () => {
  it('inserts the full callback and its checkpoint in one exclusive transaction', async () => {
    const database = new FakeDatabase();
    const result = await persistLocationBatchTransaction(database, {
      callbackId: 'callback-a',
      receivedAt: 3000,
      locations: [
        validLocation(2000, 1.2),
        validLocation(1000, 1.1),
        validLocation(4000, 100),
      ],
    });

    expect(database.transactionCount).toBe(1);
    expect(result).toMatchObject({ reported: 3, inserted: 2, duplicates: 0, invalid: 1 });
    expect(database.transaction.inserted.map((params) => params[1])).toEqual([1, 2]);
    expect(database.transaction.inserted.map((params) => params[3])).toEqual([0, 1]);
    expect(database.transaction.checkpoint).toEqual([
      2,
      2000,
      2000,
      3000,
      3000,
      3000,
      3000,
      'session-1',
    ]);
    expect(database.transaction.lastLocationCallbackAt).toBe(3000);
  });

  it('accounts for a redelivered callback without inserting fixes twice', async () => {
    const database = new FakeDatabase();
    const batch = {
      callbackId: 'callback-a',
      receivedAt: 3000,
      locations: [validLocation(1000, 1.1), validLocation(2000, 1.2)],
    };
    await persistLocationBatchTransaction(database, batch);
    const duplicate = await persistLocationBatchTransaction(database, {
      ...batch,
      receivedAt: 4000,
    });

    expect(duplicate).toMatchObject({
      reported: 2,
      inserted: 0,
      duplicates: 2,
      callbackDuplicate: true,
    });
    expect(database.transaction.inserted).toHaveLength(2);
    expect(database.transaction.lastLocationCallbackAt).toBe(4000);
  });

  it('deduplicates the same source fix delivered under a new callback ID', async () => {
    const database = new FakeDatabase();
    await persistLocationBatchTransaction(database, {
      callbackId: 'callback-a',
      receivedAt: 2000,
      locations: [validLocation(1000, 1.1)],
    });
    const result = await persistLocationBatchTransaction(database, {
      callbackId: 'callback-b',
      receivedAt: 3000,
      locations: [validLocation(1000, 1.1)],
    });
    expect(result).toMatchObject({ inserted: 0, duplicates: 1, invalid: 0 });
  });

  it('rejects a delayed fix from before the active session started', async () => {
    const database = new FakeDatabase();
    const result = await persistLocationBatchTransaction(database, {
      callbackId: 'callback-delayed',
      receivedAt: 2000,
      locations: [validLocation(499, 1.1), validLocation(500, 1.2)],
    });

    expect(result).toMatchObject({ reported: 2, inserted: 1, duplicates: 0, invalid: 1 });
    expect(database.transaction.inserted).toHaveLength(1);
    expect(database.transaction.inserted[0]?.[4]).toBe(500);
  });

  it('heartbeats callbacks that contain no fixes or only invalid fixes', async () => {
    const database = new FakeDatabase();
    await persistLocationBatchTransaction(database, {
      callbackId: 'callback-empty',
      receivedAt: 2000,
      locations: [],
    });
    const invalid = await persistLocationBatchTransaction(database, {
      callbackId: 'callback-invalid',
      receivedAt: 3000,
      locations: [validLocation(499, 1.1)],
    });

    expect(invalid.invalid).toBe(1);
    expect(database.transaction.inserted).toHaveLength(0);
    expect(database.transaction.heartbeatHistory).toEqual([2000, 3000]);
  });

  it('heartbeats source duplicates without letting an older callback move the proof backward', async () => {
    const database = new FakeDatabase();
    await persistLocationBatchTransaction(database, {
      callbackId: 'callback-a',
      receivedAt: 3000,
      locations: [validLocation(1000, 1.1)],
    });
    const duplicate = await persistLocationBatchTransaction(database, {
      callbackId: 'callback-b',
      receivedAt: 4000,
      locations: [validLocation(1000, 1.1)],
    });
    await persistLocationBatchTransaction(database, {
      callbackId: 'callback-c',
      receivedAt: 3500,
      locations: [],
    });

    expect(duplicate).toMatchObject({ inserted: 0, duplicates: 1 });
    expect(database.transaction.heartbeatHistory).toEqual([3000, 4000, 4000]);
    expect(database.transaction.lastLocationCallbackAt).toBe(4000);
  });
});
