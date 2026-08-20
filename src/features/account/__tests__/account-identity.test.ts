import { buildUnsignedIgc } from '@/recorder/igc';
import type { FlightMetricsRecord, FlightSummary, LocationFixRecord, PilotProfile } from '@/recorder/types';

import {
  accountStats,
  identityName,
  identitySubtitle,
  igcHeaderPreview,
  pilotInitials,
} from '../account-identity';

const HOUR = 3_600_000;
const UTC_PLUS_7 = -420;

function profile(overrides: Partial<PilotProfile> = {}): PilotProfile {
  return {
    pilotName: null,
    gliderType: null,
    gliderId: null,
    registrationId: null,
    updatedAt: 0,
    pushedUpdatedAt: null,
    ...overrides,
  };
}

function metrics(overrides: Partial<FlightMetricsRecord> = {}): FlightMetricsRecord {
  return {
    flightId: 'f',
    algorithmVersion: 1,
    durationMs: HOUR,
    trackDistanceMetres: 10_000,
    minGpsAltitude: 400,
    maxGpsAltitude: 1_200,
    maxGroundSpeed: 12,
    fixCount: 3_600,
    medianSourceGapMs: 1_000,
    p95SourceGapMs: 1_000,
    maxSourceGapMs: 2_000,
    quality: 'healthy',
    computedAt: 0,
    ...overrides,
  };
}

function flight(overrides: Partial<FlightSummary> & { id: string }): FlightSummary {
  const startedAt = overrides.startedAt ?? Date.UTC(2026, 7, 16, 6, 42);
  return {
    recordingSessionId: `session-${overrides.id}`,
    status: 'completed',
    startedAt,
    endedAt: startedAt + HOUR,
    timezoneOffsetMinutes: UTC_PLUS_7,
    title: null,
    site: null,
    notes: null,
    takeoffLatitude: null,
    takeoffLongitude: null,
    siteSource: null,
    createdAt: startedAt,
    updatedAt: startedAt,
    sessionStatus: 'completed',
    metrics: metrics({ flightId: overrides.id }),
    ...overrides,
  };
}

describe('pilotInitials', () => {
  it('takes the first and last word, so a middle name does not win', () => {
    expect(pilotInitials(profile({ pilotName: 'Renate Gouveia' }))).toBe('RG');
    expect(pilotInitials(profile({ pilotName: 'Renate Maria Gouveia' }))).toBe('RG');
  });

  it('handles a single name', () => {
    expect(pilotInitials(profile({ pilotName: 'Renate' }))).toBe('R');
  });

  it('is empty rather than a fake monogram when there is no name', () => {
    expect(pilotInitials(profile())).toBe('');
    expect(pilotInitials(profile({ pilotName: '   ' }))).toBe('');
  });

  it('tolerates untidy spacing', () => {
    expect(pilotInitials(profile({ pilotName: '  renate   gouveia  ' }))).toBe('RG');
  });
});

describe('identityName', () => {
  it('prompts rather than showing a blank when setup was skipped', () => {
    expect(identityName(profile())).toBe('Add your name');
    expect(identityName(profile({ pilotName: 'Renate Gouveia' }))).toBe('Renate Gouveia');
  });
});

describe('identitySubtitle', () => {
  it('is the glider', () => {
    expect(identitySubtitle(profile({ gliderType: 'Ozone Rush 6' }))).toBe('Ozone Rush 6');
  });

  it('is null when there is nothing to say', () => {
    // Sites are per-flight now; the profile has no home site to fall back to.
    expect(identitySubtitle(profile())).toBeNull();
    expect(identitySubtitle(profile({ gliderType: '   ' }))).toBeNull();
  });
});

describe('accountStats', () => {
  it('is empty for an empty logbook', () => {
    expect(accountStats([])).toEqual({ flightCount: 0, airtimeMs: 0, sinceLabel: null });
  });

  it('sums airtime and dates from the earliest flight', () => {
    const stats = accountStats([
      flight({ id: 'a', startedAt: Date.UTC(2026, 7, 16, 6, 0) }),
      flight({ id: 'b', startedAt: Date.UTC(2026, 5, 2, 6, 0), metrics: metrics({ durationMs: 2 * HOUR }) }),
    ]);
    expect(stats.flightCount).toBe(2);
    expect(stats.airtimeMs).toBe(3 * HOUR);
    expect(stats.sinceLabel).toBe('JUN 26');
  });

  it('ignores flights without metrics, matching the season card', () => {
    // The two must never disagree about how many flights this phone holds.
    const stats = accountStats([
      flight({ id: 'a' }),
      flight({ id: 'open', status: 'recording', sessionStatus: 'recording', endedAt: null }),
      flight({ id: 'busy', status: 'processing', metrics: null }),
    ]);
    expect(stats.flightCount).toBe(1);
  });

  it('dates from the takeoff timezone, not UTC', () => {
    // 31 Jul 22:00 UTC is 1 Aug locally at UTC+7 — the label follows the pilot.
    const stats = accountStats([
      flight({ id: 'a', startedAt: Date.UTC(2026, 6, 31, 22, 0), timezoneOffsetMinutes: UTC_PLUS_7 }),
    ]);
    expect(stats.sinceLabel).toBe('AUG 26');
  });
});

describe('igcHeaderPreview', () => {
  it('shows the historical placeholders for an untouched profile', () => {
    expect(igcHeaderPreview(profile())).toEqual([
      'HFPLTPILOTINCHARGE:UNSPECIFIED',
      'HFGTYGLIDERTYPE:PARAGLIDER',
      'HFGIDGLIDERID:UNSPECIFIED',
    ]);
  });

  it('sanitises exactly as the file does', () => {
    expect(igcHeaderPreview(profile({ pilotName: 'Renaté Gouveia', gliderType: 'Ozone Rush 6' }))).toEqual([
      'HFPLTPILOTINCHARGE:RENATE GOUVEIA',
      'HFGTYGLIDERTYPE:OZONE RUSH 6',
      'HFGIDGLIDERID:UNSPECIFIED',
    ]);
  });

  it('never mentions the registration ID', () => {
    // It is a licence number, and no IGC header means that. HFCIDCOMPETITIONID means the
    // number assigned for a specific competition, which is a different thing entirely.
    const preview = igcHeaderPreview(profile({ registrationId: 'APPI-12345' }));
    expect(preview.join('\n')).not.toContain('APPI');
    expect(preview.join('\n')).not.toContain('HFCID');
  });

  it('matches the header lines the emitter actually writes', () => {
    // The drift guard. If this fails, the Account screen is making a promise about the
    // contents of an evidence file that the file does not keep.
    const pilot = profile({ pilotName: 'Renate Gouveia', gliderType: 'Ozone Rush 6', gliderId: 'D-1234' });
    const startedAt = Date.UTC(2026, 7, 16, 6, 0);
    const fixes: LocationFixRecord[] = [0, 1, 2].map((index) => ({
      id: index,
      sessionId: 'session-1',
      sequence: index,
      callbackId: 'cb',
      batchIndex: index,
      sourceTimestamp: startedAt + index * 1000,
      receiptTimestamp: startedAt + index * 1000,
      latitude: 43.38,
      longitude: -3.08,
      gpsAltitude: 500,
      verticalAccuracy: 3,
      horizontalAccuracy: 4,
      speed: 9,
      heading: 180,
      mocked: false,
    }));
    const igc = buildUnsignedIgc(
      { id: 'session-1', startedAt, endedAt: startedAt + 3000 },
      fixes,
      { pilotName: pilot.pilotName, gliderType: pilot.gliderType, gliderId: pilot.gliderId },
    );
    const emitted = igc.content
      .split('\r\n')
      .filter((line) => /^HF(PLT|GTY|GID)/.test(line));
    expect(igcHeaderPreview(pilot)).toEqual(emitted);
  });
});
