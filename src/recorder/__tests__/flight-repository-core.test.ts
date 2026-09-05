import {
  flightStatusForSession,
  normalizeFlightMetadataPatch,
  normalizePilotProfilePatch,
} from '../flight-repository-core';

describe('pilot profile patch normalization', () => {
  it('carries registrationId through with the text fields', () => {
    // Guards the silent-drop failure: the field is normalized here, but it also has to be
    // in PILOT_PROFILE_COLUMNS or the UPDATE never writes it.
    expect(normalizePilotProfilePatch({ registrationId: '  appi-123  ' })).toEqual({
      registrationId: 'appi-123',
    });
    expect(normalizePilotProfilePatch({ registrationId: '   ' })).toEqual({
      registrationId: null,
    });
  });

  it('leaves untouched fields out entirely, so a partial patch stays partial', () => {
    expect(normalizePilotProfilePatch({ pilotName: 'Renate' })).toEqual({
      pilotName: 'Renate',
    });
  });
});

describe('flight repository metadata', () => {
  it('trims values, converts blank values to null, and preserves omitted fields', () => {
    expect(
      normalizeFlightMetadataPatch({ title: '  Evening ridge  ', site: '   ', notes: null }),
    ).toEqual({ title: 'Evening ridge', site: null, notes: null });
    expect(normalizeFlightMetadataPatch({ site: 'Bukit Kutu' })).toEqual({ site: 'Bukit Kutu' });
  });

  it('enforces the persisted metadata limits after trimming', () => {
    expect(() => normalizeFlightMetadataPatch({ title: 'x'.repeat(121) })).toThrow(
      'title must be 120 characters or fewer.',
    );
    expect(() => normalizeFlightMetadataPatch({ site: 'x'.repeat(121) })).toThrow(
      'site must be 120 characters or fewer.',
    );
    expect(() => normalizeFlightMetadataPatch({ notes: 'x'.repeat(4_001) })).toThrow(
      'notes must be 4000 characters or fewer.',
    );
  });
});

describe('pilot profile metadata', () => {
  it('trims values, converts blank values to null, and preserves omitted fields', () => {
    expect(normalizePilotProfilePatch({ pilotName: '  Renate  ', gliderId: '   ' })).toEqual({
      pilotName: 'Renate',
      gliderId: null,
    });
    expect(normalizePilotProfilePatch({})).toEqual({});
    expect(normalizePilotProfilePatch({ gliderType: null })).toEqual({ gliderType: null });
  });

  it('enforces the IGC-friendly length limits after trimming', () => {
    expect(() => normalizePilotProfilePatch({ pilotName: 'x'.repeat(61) })).toThrow(
      /pilotName must be 60 characters or fewer/,
    );
    expect(normalizePilotProfilePatch({ pilotName: `  ${'x'.repeat(60)}  ` })).toEqual({
      pilotName: 'x'.repeat(60),
    });
    expect(() => normalizePilotProfilePatch({ gliderId: 'y'.repeat(31) })).toThrow(
      /gliderId must be 30 characters or fewer/,
    );
    expect(() =>
      normalizePilotProfilePatch({ gliderType: 42 as unknown as string }),
    ).toThrow(TypeError);
  });
});

describe('legacy flight status mapping', () => {
  it('maps stopped, partial, and unfinished sessions deterministically', () => {
    expect(flightStatusForSession('completed', 'stopped')).toBe('completed');
    expect(flightStatusForSession('completed', 'interrupted_finalized')).toBe('partial');
    expect(flightStatusForSession('completed', null)).toBe('partial');
    expect(flightStatusForSession('recording', null)).toBe('recording');
    expect(flightStatusForSession('interrupted', null)).toBe('recording');
  });
});
