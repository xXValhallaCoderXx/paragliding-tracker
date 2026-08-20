import type { FlightMetricsRecord, FlightSummary } from '@/recorder/types';

import {
  GUEST_FLIGHT_CAPACITY,
  countSavedFlights,
  evaluateGuestCapacity,
  backupSummary,
  guestCapacityNotice,
  isRemovableFlight,
  oldestRemovableFlight,
  removalGuidance,
  type GuestCapacityInput,
} from '../guest-capacity';
import { buildLogbookLayout } from '../logbook';

const UTC_PLUS_7 = -420;
const HOUR = 3_600_000;

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
    siteResolvedAt: null,
    createdAt: startedAt,
    updatedAt: startedAt,
    sessionStatus: 'completed',
    metrics: metrics({ flightId: overrides.id }),
    ...overrides,
  };
}

/** A guest on a phone that has never been bound to an account. */
function guest(savedFlights: number, overrides: Partial<GuestCapacityInput> = {}) {
  return evaluateGuestCapacity({
    savedFlights,
    authStatus: 'signed_out',
    linkedUserId: null,
    ...overrides,
  });
}

describe('evaluateGuestCapacity', () => {
  it('is clear well below the limit', () => {
    expect(guest(0)).toMatchObject({ level: 'clear', remaining: 10, over: 0 });
    expect(guest(7)).toMatchObject({ level: 'clear', remaining: 3, over: 0 });
  });

  it('warns before the limit, not after it', () => {
    expect(guest(8)).toMatchObject({ level: 'near', remaining: 2, over: 0 });
    expect(guest(9)).toMatchObject({ level: 'near', remaining: 1, over: 0 });
  });

  it('reports full exactly at the limit', () => {
    expect(guest(GUEST_FLIGHT_CAPACITY)).toMatchObject({
      level: 'full',
      remaining: 0,
      over: 0,
    });
  });

  it('reports how far over the line the pilot is', () => {
    expect(guest(11)).toMatchObject({ level: 'over', remaining: 0, over: 1 });
    expect(guest(40)).toMatchObject({ level: 'over', remaining: 0, over: 30 });
  });

  it('exempts a signed-in pilot at any count', () => {
    expect(guest(400, { authStatus: 'signed_in' })).toMatchObject({
      level: 'exempt',
      exemption: 'signed_in',
    });
  });

  it('exempts a pilot whose session is still restoring', () => {
    // Regression guard: initialAuthSnapshot() is 'restoring' until restore() resolves,
    // while the logbook renders immediately. Treating that as signed-out would flash a
    // capacity banner at every signed-in pilot on every cold start.
    expect(guest(40, { authStatus: 'restoring' })).toMatchObject({
      level: 'exempt',
      exemption: 'unknown',
    });
  });

  it('exempts a signed-out phone that has been bound to an account', () => {
    // Signing out must not be a capacity cliff demanding 30 backed-up flights be deleted.
    expect(guest(40, { linkedUserId: 'user-1' })).toMatchObject({
      level: 'exempt',
      exemption: 'linked',
    });
  });

  it('exempts builds that have no cloud configured', () => {
    // Never offer an account a build cannot create.
    for (const authStatus of ['unconfigured', 'unsupported'] as const) {
      expect(guest(40, { authStatus })).toMatchObject({
        level: 'exempt',
        exemption: 'unavailable',
      });
    }
  });

  it('prefers the signed-in reason over the linked one', () => {
    expect(guest(40, { authStatus: 'signed_in', linkedUserId: 'user-1' })).toMatchObject({
      exemption: 'signed_in',
    });
  });

  it('honours a custom limit and warning threshold', () => {
    expect(guest(2, { limit: 3, warnFrom: 2 })).toMatchObject({ level: 'near', remaining: 1 });
    expect(guest(3, { limit: 3, warnFrom: 2 })).toMatchObject({ level: 'full' });
    expect(guest(4, { limit: 3, warnFrom: 2 })).toMatchObject({ level: 'over', over: 1 });
  });

  it('refuses a limit that would put everyone permanently over', () => {
    expect(() => guest(1, { limit: 0 })).toThrow(/at least 1/);
  });
});

describe('countSavedFlights', () => {
  it('never counts the open flight', () => {
    const layout = buildLogbookLayout([
      flight({ id: 'open', status: 'recording', sessionStatus: 'recording', endedAt: null }),
      ...Array.from({ length: 10 }, (_, index) =>
        flight({ id: `f${index}`, startedAt: Date.UTC(2026, 6, index + 1, 6, 0) }),
      ),
    ]);
    expect(countSavedFlights(layout)).toBe(10);
  });

  it('counts a processing flight, because the pilot can see it', () => {
    const layout = buildLogbookLayout([
      flight({ id: 'done' }),
      flight({ id: 'busy', status: 'processing', metrics: null }),
    ]);
    expect(countSavedFlights(layout)).toBe(2);
  });

  it('is zero for an empty logbook', () => {
    expect(countSavedFlights(buildLogbookLayout([]))).toBe(0);
  });
});

describe('isRemovableFlight', () => {
  it('accepts what deleteCompletedFlight accepts', () => {
    expect(isRemovableFlight(flight({ id: 'a' }))).toBe(true);
    expect(isRemovableFlight(flight({ id: 'b', status: 'partial' }))).toBe(true);
    // Metrics are not required, and a trackless flight is still deletable.
    expect(isRemovableFlight(flight({ id: 'c', metrics: null }))).toBe(true);
    expect(
      isRemovableFlight(flight({ id: 'd', metrics: metrics({ quality: 'no_track' }) })),
    ).toBe(true);
  });

  it('refuses a flight the repository would throw on', () => {
    expect(isRemovableFlight(flight({ id: 'busy', status: 'processing' }))).toBe(false);
    expect(
      isRemovableFlight(
        flight({ id: 'open', status: 'recording', sessionStatus: 'recording', endedAt: null }),
      ),
    ).toBe(false);
  });
});

describe('oldestRemovableFlight', () => {
  it('finds the oldest flight across month sections', () => {
    const layout = buildLogbookLayout([
      flight({ id: 'aug', startedAt: Date.UTC(2026, 7, 3, 6, 0) }),
      flight({ id: 'jun', startedAt: Date.UTC(2026, 5, 9, 6, 0) }),
      flight({ id: 'jul', startedAt: Date.UTC(2026, 6, 21, 6, 0) }),
    ]);
    expect(oldestRemovableFlight(layout)?.id).toBe('jun');
  });

  it('skips flights that are still processing rather than giving up', () => {
    const layout = buildLogbookLayout([
      flight({ id: 'oldest', startedAt: Date.UTC(2026, 5, 1, 6, 0), status: 'processing' }),
      flight({ id: 'older', startedAt: Date.UTC(2026, 5, 2, 6, 0), status: 'processing' }),
      flight({ id: 'usable', startedAt: Date.UTC(2026, 5, 3, 6, 0) }),
    ]);
    expect(oldestRemovableFlight(layout)?.id).toBe('usable');
  });

  it('returns null when nothing can be removed', () => {
    expect(oldestRemovableFlight(buildLogbookLayout([]))).toBeNull();
    const stuck = buildLogbookLayout([flight({ id: 'busy', status: 'processing' })]);
    expect(oldestRemovableFlight(stuck)).toBeNull();
  });
});

describe('guestCapacityNotice', () => {
  const oldest = flight({ id: 'oldest', startedAt: Date.UTC(2026, 5, 1, 6, 0) });

  it('says nothing when exempt or clear', () => {
    expect(guestCapacityNotice(guest(40, { authStatus: 'signed_in' }), oldest)).toBeNull();
    expect(guestCapacityNotice(guest(3), oldest)).toBeNull();
  });

  it('lets the pilot dismiss a warning, but not the over state', () => {
    expect(guestCapacityNotice(guest(8), oldest)).toMatchObject({
      key: 'near',
      tone: 'warning',
      dismissible: true,
    });
    expect(guestCapacityNotice(guest(10), oldest)).toMatchObject({
      key: 'full',
      tone: 'warning',
      dismissible: true,
    });
    expect(guestCapacityNotice(guest(11), oldest)).toMatchObject({
      key: 'over',
      tone: 'danger',
      dismissible: false,
    });
  });

  it('offers the oldest removable flight by id', () => {
    expect(guestCapacityNotice(guest(11), oldest)?.remove?.flightId).toBe('oldest');
  });

  it('offers no remove button when nothing is removable', () => {
    const notice = guestCapacityNotice(guest(11), null);
    expect(notice).toMatchObject({ key: 'over-blocked', remove: null, dismissible: false });
    expect(notice?.body).toMatch(/still finishing/i);
  });

  it('promises, at every level, that nothing is deleted for the pilot', () => {
    // A drift test on a promise, in the spirit of theme-css.test.ts. If this copy ever
    // stops saying it, the feature has quietly become something else.
    for (const saved of [8, 10, 11]) {
      const notice = guestCapacityNotice(guest(saved), oldest);
      expect(notice?.body).toMatch(/nothing is ever removed for you/i);
    }
    expect(guestCapacityNotice(guest(11), null)?.body).toMatch(
      /nothing is ever removed for you/i,
    );
  });

  it('never makes removal the primary action', () => {
    for (const saved of [8, 10, 11]) {
      expect(guestCapacityNotice(guest(saved), oldest)?.primaryLabel).toBe(
        'Create a free account',
      );
    }
  });
});

describe('backupSummary', () => {
  it('shows the meter and the same count the logbook uses', () => {
    const summary = backupSummary(guest(6));
    expect(summary).toMatchObject({
      headline: 'Kept on this phone only',
      value: '6 / 10',
      ctaLabel: 'Back up for free',
    });
    expect(summary.meter).toEqual({ value: 6, max: 10, tone: 'neutral' });
    expect(summary.detail).toContain('Four more');
    expect(summary.detail).toContain('Nothing is ever removed for you');
  });

  it('says "One more" rather than "1 more"', () => {
    expect(backupSummary(guest(9)).detail).toContain('One more');
  });

  it('warns that the next flight goes over, at exactly the limit', () => {
    const summary = backupSummary(guest(10));
    expect(summary.detail).toContain('next flight puts you over');
    expect(summary.meter?.tone).toBe('warning');
  });

  it('turns danger-toned once over, and never overflows the bar', () => {
    const summary = backupSummary(guest(14));
    expect(summary.meter).toEqual({ value: 14, max: 10, tone: 'danger' });
    expect(summary.detail).toContain('4 over');
  });

  it('drops the meter and the offer once signed in', () => {
    const summary = backupSummary(guest(40, { authStatus: 'signed_in' }));
    expect(summary).toMatchObject({ headline: 'Backed up', value: null, ctaLabel: null });
    expect(summary.meter).toBeNull();
  });

  it('offers no account in a build that has no cloud', () => {
    const summary = backupSummary(guest(3, { authStatus: 'unconfigured' }));
    expect(summary.ctaLabel).toBeNull();
    expect(summary.detail).toContain('built with a cloud project');
  });

  it('invites a signed-out but previously linked phone back in, with no cap', () => {
    const summary = backupSummary(guest(40, { linkedUserId: 'user-1' }));
    expect(summary).toMatchObject({ value: null, ctaLabel: 'Back up for free' });
    expect(summary.meter).toBeNull();
  });
});

describe('removalGuidance', () => {
  it('names the flight so the pilot knows what they are about to lose', () => {
    const guidance = removalGuidance(flight({ id: 'a', site: 'Bassano' }));
    expect(guidance.body).toContain('Bassano');
    expect(guidance.body).toContain('16 Aug 2026');
  });

  it('is a pure function of its argument', () => {
    const subject = flight({ id: 'a' });
    expect(removalGuidance(subject)).toEqual(removalGuidance(subject));
  });
});
