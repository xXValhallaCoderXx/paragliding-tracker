import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { SqlExecutor } from '../repository-core';
import {
  APPLY_REMOTE_FLIGHT_METADATA_SQL,
  BIND_CLOUD_LINK_SQL,
  COUNT_PENDING_SYNC_SQL,
  DIRTY_FLIGHTS_SQL,
  MARK_FLIGHT_PUSHED_SQL,
  PENDING_FLIGHT_DELETIONS_SQL,
  applyRemoteFlightMetadataTransaction,
  mapFlightSyncCandidate,
  resetCloudLinkTransaction,
  updatePilotProfileTransaction,
  type FlightSyncCandidateRow,
} from '../sync-repository-core';

class FakeTransaction implements SqlExecutor {
  readonly statements: { source: string; params: unknown[] }[] = [];
  changes = 1;
  /** Whether the flight row exists locally, for the pull-outcome tests. */
  flightExists = false;

  async getFirstAsync<T>(source: string): Promise<T | null> {
    if (source.includes('FROM flights WHERE id = ?')) {
      return (this.flightExists ? { present: 1 } : null) as T | null;
    }
    return null;
  }

  async runAsync(source: string, ...params: unknown[]) {
    this.statements.push({ source, params });
    return { changes: this.changes };
  }

  sources(): string {
    return this.statements.map((statement) => statement.source).join('\n---\n');
  }
}

describe('dirty flight selection', () => {
  it('never offers an in-progress or unfinished flight to the pusher', () => {
    // The sync gate already refuses to run while recording. This predicate makes the
    // same guarantee independently, so a gate bug cannot leak a live flight to the
    // network: an in-flight session's updated_at churns once per second and its
    // metrics are not final.
    expect(DIRTY_FLIGHTS_SQL).toContain("s.status = 'completed'");
    expect(DIRTY_FLIGHTS_SQL).toContain("f.status IN ('completed', 'partial')");
  });

  it('treats a missing sync-state row as never pushed, so nothing needs backfilling', () => {
    expect(DIRTY_FLIGHTS_SQL).toContain('LEFT JOIN flight_sync_state st ON st.flight_id = f.id');
    expect(DIRTY_FLIGHTS_SQL).toContain(
      '(st.pushed_updated_at IS NULL OR st.pushed_updated_at < f.updated_at)',
    );
  });

  it('honours per-row backoff and pushes the oldest flights first', () => {
    expect(DIRTY_FLIGHTS_SQL).toContain('COALESCE(st.next_attempt_at, 0) <= ?');
    expect(DIRTY_FLIGHTS_SQL).toContain('ORDER BY f.started_at ASC, f.id ASC');
    expect(DIRTY_FLIGHTS_SQL).toContain('LIMIT ?');
  });

  it('counts pending work with the same predicate the pusher uses', () => {
    expect(COUNT_PENDING_SYNC_SQL).toContain("s.status = 'completed'");
    expect(COUNT_PENDING_SYNC_SQL).toContain(
      '(st.pushed_updated_at IS NULL OR st.pushed_updated_at < f.updated_at)',
    );
    expect(COUNT_PENDING_SYNC_SQL).toContain('FROM flight_deletions');
  });

  it('maps a candidate row, tolerating a flight whose metrics were never computed', () => {
    const base: FlightSyncCandidateRow = {
      id: 'flight-1',
      recording_session_id: 'session-1',
      status: 'completed',
      started_at: 1000,
      ended_at: 5000,
      timezone_offset_minutes: 60,
      title: 'Sunset glass-off',
      site: 'Sopelana',
      takeoff_latitude: 43.38,
      takeoff_longitude: -3.08,
      site_source: 'manual',
      notes: null,
      created_at: 900,
      updated_at: 6000,
      session_status: 'completed',
      pushed_updated_at: null,
      igc_sha256: null,
      igc_object_path: null,
      attempt_count: null,
      next_attempt_at: null,
      algorithm_version: null,
      duration_ms: null,
      track_distance_metres: null,
      min_gps_altitude: null,
      max_gps_altitude: null,
      max_ground_speed: null,
      fix_count: null,
      median_source_gap_ms: null,
      p95_source_gap_ms: null,
      max_source_gap_ms: null,
      quality: null,
      computed_at: null,
    };

    expect(mapFlightSyncCandidate(base)).toMatchObject({
      id: 'flight-1',
      recordingSessionId: 'session-1',
      title: 'Sunset glass-off',
      metrics: null,
      pushedUpdatedAt: null,
      attemptCount: 0,
      nextAttemptAt: 0,
    });

    expect(
      mapFlightSyncCandidate({
        ...base,
        algorithm_version: 3,
        computed_at: 6100,
        duration_ms: 4000,
        track_distance_metres: 12_345.6,
        fix_count: 240,
        quality: 'healthy',
        attempt_count: 2,
        next_attempt_at: 7000,
      }).metrics,
    ).toMatchObject({ flightId: 'flight-1', algorithmVersion: 3, quality: 'healthy', fixCount: 240 });
  });
});

describe('remote metadata merge', () => {
  it('compares and writes in one guarded statement so a concurrent local edit cannot be lost', () => {
    expect(APPLY_REMOTE_FLIGHT_METADATA_SQL).toContain('WHERE id = ? AND updated_at < ?');
    // Flight facts are local-wins unconditionally: the phone is the recorder.
    for (const column of ['status', 'started_at', 'ended_at', 'recording_session_id']) {
      expect(APPLY_REMOTE_FLIGHT_METADATA_SQL).not.toContain(`${column} =`);
    }
  });

  it('advances the push watermark when the remote edit wins, closing the echo loop', async () => {
    const transaction = new FakeTransaction();
    transaction.changes = 1;

    await expect(
      applyRemoteFlightMetadataTransaction(
        transaction,
        {
          flightId: 'flight-1',
          title: 'Renamed elsewhere',
          site: null,
          notes: null,
          clientUpdatedAt: 9000,
        },
        '2026-08-18T10:00:00Z',
      ),
    ).resolves.toBe('applied');

    expect(transaction.statements).toHaveLength(2);
    expect(transaction.statements[1]!.source).toBe(MARK_FLIGHT_PUSHED_SQL);
    expect(transaction.statements[1]!.params).toEqual(['flight-1', 9000, '2026-08-18T10:00:00Z']);
  });

  it('leaves the watermark alone when the local row is newer, so the next push corrects the server', async () => {
    const transaction = new FakeTransaction();
    transaction.changes = 0;
    transaction.flightExists = true;

    await expect(
      applyRemoteFlightMetadataTransaction(
        transaction,
        { flightId: 'flight-1', title: 'Stale', site: null, notes: null, clientUpdatedAt: 100 },
        '2026-08-18T10:00:00Z',
      ),
    ).resolves.toBe('local_newer');

    expect(transaction.statements).toHaveLength(1);
    expect(transaction.sources()).not.toContain('flight_sync_state');
  });

  it('distinguishes a flight this device never held from one it holds a newer copy of', async () => {
    // Both leave the UPDATE with zero changes. Conflating them would report every
    // locally-edited flight as "recorded on another phone" in the account screen.
    const transaction = new FakeTransaction();
    transaction.changes = 0;
    transaction.flightExists = false;

    await expect(
      applyRemoteFlightMetadataTransaction(
        transaction,
        { flightId: 'other-phone', title: null, site: null, notes: null, clientUpdatedAt: 100 },
        '2026-08-18T10:00:00Z',
      ),
    ).resolves.toBe('missing');

    // Nothing is written for a flight that is not here: restore is out of scope, so a
    // cloud-only flight is counted and never materialised.
    expect(transaction.sources()).not.toContain('flight_sync_state');
  });
});

describe('cloud link binding', () => {
  it('only claims an unclaimed device, so one pilot never uploads into another pilot account', () => {
    expect(BIND_CLOUD_LINK_SQL).toContain('WHERE id = 1 AND user_id IS NULL');
  });

  it('rebinding drops every sync watermark but never touches a flight or its evidence', async () => {
    const transaction = new FakeTransaction();

    await resetCloudLinkTransaction(transaction, 'user-2', 4242);

    const sources = transaction.sources();
    expect(sources).toContain('DELETE FROM flight_sync_state');
    expect(sources).toContain('UPDATE cloud_link');
    expect(sources).toContain('UPDATE pilot_profile SET pushed_updated_at = NULL');
    // The whole point: changing accounts must never cost the pilot their logbook.
    for (const table of [
      'flights',
      'sessions',
      'location_fixes',
      'pressure_samples',
      'events',
      'exports',
      'flight_metrics',
      'flight_deletions',
    ]) {
      expect(sources).not.toContain(`DELETE FROM ${table}`);
    }
    expect(transaction.statements[1]!.params).toEqual(['user-2', 4242]);
  });

  it('unbinding stores a null linked_at rather than a stale timestamp', async () => {
    const transaction = new FakeTransaction();
    await resetCloudLinkTransaction(transaction, null, 4242);
    expect(transaction.statements[1]!.params).toEqual([null, null]);
  });
});

describe('pilot profile writes', () => {
  it('updates only the supplied fields and stamps updated_at', async () => {
    const transaction = new FakeTransaction();

    await updatePilotProfileTransaction(transaction, { pilotName: 'Renate', gliderId: null }, 555);

    expect(transaction.statements).toHaveLength(1);
    expect(transaction.statements[0]!.source).toBe(
      'UPDATE pilot_profile SET pilot_name = ?, glider_id = ?, updated_at = ? WHERE id = 1',
    );
    expect(transaction.statements[0]!.params).toEqual(['Renate', null, 555]);
  });

  it('leaves pushed_updated_at alone so an edit simply makes the row dirty again', async () => {
    const transaction = new FakeTransaction();
    await updatePilotProfileTransaction(transaction, { gliderType: 'Ozone Rush 6' }, 555);
    expect(transaction.sources()).not.toContain('pushed_updated_at');
  });
});

describe('remote metadata', () => {
  it('never inherits provenance from a site that arrived from another device', () => {
    // site_source is not pushed, so a name pulled from elsewhere carries none this device
    // can vouch for. Leaving the old value would credit a catalogue — and attach its
    // licence — to a string that may have been typed by hand on a different phone.
    expect(APPLY_REMOTE_FLIGHT_METADATA_SQL).toContain(
      "site_source = CASE WHEN ? IS NULL THEN NULL ELSE 'manual' END",
    );
  });

  it('still only applies to a row the remote edit is newer than', () => {
    expect(APPLY_REMOTE_FLIGHT_METADATA_SQL).toContain('WHERE id = ? AND updated_at < ?');
  });
});

describe('deletion queue', () => {
  it('drains tombstones oldest first and honours their backoff', () => {
    expect(PENDING_FLIGHT_DELETIONS_SQL).toContain('WHERE next_attempt_at <= ?');
    expect(PENDING_FLIGHT_DELETIONS_SQL).toContain('ORDER BY deleted_at ASC, flight_id ASC');
  });
});

describe('cloud backup stays out of the capture path', () => {
  it('never writes a table the recorder owns during a flight', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/recorder/sync-repository-core.ts'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');

    for (const table of [
      'sessions',
      'location_fixes',
      'pressure_samples',
      'events',
      'exports',
      'session_recovery_attempts',
    ]) {
      expect(source).not.toContain(`INSERT INTO ${table}`);
      expect(source).not.toContain(`UPDATE ${table}`);
      expect(source).not.toContain(`DELETE FROM ${table}`);
    }
    // flights is written for exactly one reason: the guarded metadata pull-back.
    expect(source.match(/UPDATE flights/g)).toHaveLength(1);
  });
});
