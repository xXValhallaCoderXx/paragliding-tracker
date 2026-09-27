import { flight, metrics } from '../../../../tests/support/fixtures';
import type { EquipmentSnapshot } from '@/equipment/types';
import type { ArchivedFlightSummary, FlightSummary } from '@/recorder/types';
import { activeFilterCount, defaultJournalCriteria, journalFilterChips, journalFlightMetrics, journalQualityExplanation,
  journalQualityFlags, removeJournalFilter, selectJournal, type JournalCriteria } from '../journal-query';

const criteria = (patch: Partial<JournalCriteria> = {}): JournalCriteria => ({ ...defaultJournalCriteria(), ...patch });
const snapshot = (patch: Partial<EquipmentSnapshot> = {}): EquipmentSnapshot => ({ version: 1, capturedAt: 1000,
  aircraftId: 'wing-a', sport: 'paragliding', model: 'Rush', size: 'M', registrationId: 'D-123', ...patch });
const none = snapshot({ aircraftId: null, sport: null, model: null, size: null, registrationId: null });
const archive = (patch: Partial<ArchivedFlightSummary> = {}): ArchivedFlightSummary => ({ ...flight(), id: 'archived', source: 'archive',
  ownerUserId: 'owner', sessionStatus: null, archive: { trackState: 'pending', downloadedAt: null, error: null }, ...patch });
const ids = (flights: readonly FlightSummary[]) => flights.map(item => item.id);

it('keeps the newest unfinished recorder outside filters, totals, and all saved facets', () => {
  const result = selectJournal([
    flight({ id: 'saved', site: 'Hill', status: 'processing', metrics: null }),
    flight({ id: 'older-open', sessionStatus: 'recording', startedAt: 1, site: 'Hidden site' }),
    flight({ id: 'open', sessionStatus: 'interrupted', startedAt: 2, site: 'Hidden site' }),
  ], criteria({ sites: ['site:elsewhere'] }));
  expect(result.open?.id).toBe('open');
  expect(result).toMatchObject({ totalCount: 1, matchedCount: 0, flights: [], sections: [], summary: {
    flightCount: 0, timeCount: 0, distanceCount: 0, recordedTimeMs: null, longestMs: null, longestDistanceMetres: null,
  } });
  expect(result.facets.sites.map(option => option.label)).not.toContain('Hidden site');
});

it('uses OR within facets and AND between facets over the entire catalogue', () => {
  const flights = [
    flight({ id: 'pg-hill', site: '  BIG   Hill ', equipmentSnapshot: snapshot(), metrics: metrics({ quality: 'gaps' }) }),
    flight({ id: 'hg-hill', site: 'big hill', equipmentSnapshot: snapshot({ aircraftId: 'wing-b', sport: 'hang_gliding' }) }),
    flight({ id: 'pg-coast', site: 'Coast', equipmentSnapshot: snapshot() }),
    flight({ id: 'speed-hill', site: 'Big Hill', equipmentSnapshot: snapshot({ aircraftId: 'wing-c', sport: 'speedflying' }) }),
  ];
  const result = selectJournal(flights, criteria({ sites: ['site:big hill'], sports: ['paragliding', 'hang_gliding'], qualities: ['healthy', 'gaps'] }));
  expect(ids(result.flights)).toEqual(['hg-hill', 'pg-hill']);
  expect(result.totalCount).toBe(4);
  expect(result.facets.sites).toHaveLength(2);
  expect(result.facets.sports.map(option => option.value)).toContain('speedflying');
  expect(result.facets.aircraft).toHaveLength(3);
});

it('keeps unnamed sites separate from a site literally named unknown', () => {
  const flights = [flight({ id: 'unnamed' }), flight({ id: 'named', site: 'Unknown' })];
  expect(ids(selectJournal(flights, criteria({ sites: ['unknown'] })).flights)).toEqual(['unnamed']);
  expect(ids(selectJournal(flights, criteria({ sites: ['site:unknown'] })).flights)).toEqual(['named']);
});

it('distinguishes legacy unknown and explicit no-aircraft snapshots without inferring a sport', () => {
  const flights = [flight({ id: 'legacy' }), flight({ id: 'none', equipmentSnapshot: none }), flight({ id: 'selected', equipmentSnapshot: snapshot() })];
  expect(ids(selectJournal(flights, criteria({ aircraft: ['unknown'] })).flights)).toEqual(['legacy']);
  expect(ids(selectJournal(flights, criteria({ aircraft: ['none'] })).flights)).toEqual(['none']);
  expect(ids(selectJournal(flights, criteria({ sports: ['unknown'] })).flights)).toEqual(['legacy', 'none']);
  expect(selectJournal(flights, criteria()).facets.aircraft).toEqual(expect.arrayContaining([
    { value: 'unknown', label: 'Unknown aircraft' }, { value: 'none', label: 'No aircraft selected' },
  ]));
});

it('uses a historical UUID across renames and restored flights, with its newest recorded label', () => {
  const flights = [flight({ id: 'old', startedAt: 1000, equipmentSnapshot: snapshot({ model: 'Old name' }) }),
    archive({ id: 'new', startedAt: 2000, equipmentSnapshot: snapshot({ model: 'Recorded later' }) })];
  const result = selectJournal(flights, criteria({ aircraft: ['wing-a'] }));
  expect(ids(result.flights)).toEqual(['new', 'old']);
  expect(result.facets.aircraft).toEqual([{ value: 'wing-a', label: 'Recorded later' }]);
  expect(flights[0]!.equipmentSnapshot!.model).toBe('Old name');
});

it('disambiguates duplicate aircraft models using frozen details and stable identity when details also match', () => {
  const flights = [flight({ id: 'a', equipmentSnapshot: snapshot({ aircraftId: 'wing-00000001' }) }),
    flight({ id: 'b', equipmentSnapshot: snapshot({ aircraftId: 'wing-00000002', size: 'L' }) }),
    flight({ id: 'c', equipmentSnapshot: snapshot({ aircraftId: 'wing-00000003' }) })];
  const choices = selectJournal(flights, criteria()).facets.aircraft;
  expect(new Set(choices.map(option => option.label)).size).toBe(3);
  expect(choices.find(option => option.value === 'wing-00000002')!.label).toContain('L');
  expect(choices.find(option => option.value === 'wing-00000001')!.label).toContain('D-123');
  expect(choices.find(option => option.value === 'wing-00000001')!.label).toContain('Last recorded');
  expect(choices.find(option => option.value === 'wing-00000001')!.label).toContain('Aircraft 1');
  expect(choices.find(option => option.value === 'wing-00000003')!.label).toContain('Aircraft 2');
  expect(choices.some(option => /wing-|0000000/.test(option.label))).toBe(false);
  expect(ids(selectJournal(flights, criteria({ aircraft: ['wing-00000001'] })).flights)).toEqual(['a']);
});

it('applies the flight-local start year, preserves legacy timezone fallback, and never falls back from an empty chosen year', () => {
  const instant = Date.UTC(2025, 11, 31, 20);
  const flights = [flight({ id: 'east', startedAt: instant, timezoneOffsetMinutes: -480 }),
    flight({ id: 'west', startedAt: instant, timezoneOffsetMinutes: 300 }),
    flight({ id: 'legacy', startedAt: Date.UTC(2024, 5, 15, 12), timezoneOffsetMinutes: null })];
  expect(ids(selectJournal(flights, criteria({ year: 2026 })).flights)).toEqual(['east']);
  expect(ids(selectJournal(flights, criteria({ year: 2025 })).flights)).toEqual(['west']);
  expect(ids(selectJournal(flights, criteria({ year: new Date(flights[2]!.startedAt).getFullYear() })).flights)).toEqual(['legacy']);
  expect(selectJournal(flights, criteria({ year: 2027 }), 2028)).toMatchObject({ matchedCount: 0 });
  expect(selectJournal(flights, criteria({ year: 2027 }), 2028).facets.years.map(option => option.value)).toEqual(['2028', '2027', '2026', '2025', '2024']);
});

it('counts every saved result while tracking usable time and distance coverage independently', () => {
  const result = selectJournal([
    flight({ id: 'good', metrics: metrics({ durationMs: 1000, trackDistanceMetres: 50 }) }),
    flight({ id: 'partial', status: 'partial', metrics: metrics({ durationMs: 2000, trackDistanceMetres: 70, quality: 'partial' }) }),
    flight({ id: 'gaps', metrics: metrics({ durationMs: 3000, trackDistanceMetres: 90, quality: 'gaps' }) }),
    flight({ id: 'no-track', metrics: metrics({ durationMs: 4000, trackDistanceMetres: 0, fixCount: 0, quality: 'no_track' }) }),
    flight({ id: 'one-fix', metrics: metrics({ durationMs: 5000, trackDistanceMetres: 0, fixCount: 1 }) }),
    flight({ id: 'processing', status: 'processing', metrics: metrics({ durationMs: 100_000 }) }),
    archive({ id: 'unavailable', metrics: null }),
  ], criteria());
  expect(result.summary).toEqual({ flightCount: 7, recordedTimeMs: 15_000, longestMs: 5000, longestDistanceMetres: 90, timeCount: 5, distanceCount: 3 });
});

it('keeps null statistics distinct from measured zero and rejects negative/nonfinite measurements', () => {
  expect(selectJournal([flight({ metrics: null })], criteria()).summary).toMatchObject({ recordedTimeMs: null, longestMs: null, longestDistanceMetres: null });
  expect(journalFlightMetrics(flight({ metrics: metrics({ durationMs: 0, trackDistanceMetres: 0, fixCount: 2 }) }))).toEqual({ durationMs: 0, distanceMetres: 0 });
  expect(journalFlightMetrics(flight({ metrics: metrics({ durationMs: NaN, trackDistanceMetres: -1 }) }))).toEqual({ durationMs: null, distanceMetres: null });
  expect(journalFlightMetrics(flight({ metrics: metrics({ durationMs: -1, trackDistanceMetres: Infinity }) }))).toEqual({ durationMs: null, distanceMetres: null });
  expect(journalFlightMetrics(flight({ metrics: metrics({ durationMs: 1000, quality: 'no_track', fixCount: 5, trackDistanceMetres: 100 }) })))
    .toEqual({ durationMs: 1000, distanceMetres: null });
  expect(journalFlightMetrics(flight({ metrics: metrics({ durationMs: NaN, trackDistanceMetres: 100 }) })))
    .toEqual({ durationMs: null, distanceMetres: 100 });
  expect(journalFlightMetrics(flight({ sessionStatus: 'interrupted' }))).toEqual({ durationMs: null, distanceMetres: null });
});

it('does not require restored original IGC downloads to count saved summary metrics', () => {
  const result = selectJournal(['pending', 'error', 'missing', 'ready'].map((state, index) => archive({ id: String(index),
    archive: { trackState: state as ArchivedFlightSummary['archive']['trackState'], downloadedAt: null, error: null } })), criteria());
  expect(result.summary).toMatchObject({ flightCount: 4, timeCount: 4, distanceCount: 4 });
});

it('defines overlapping partial/no-track quality without a contradictory good-track flag', () => {
  const partial = flight({ status: 'partial', metrics: metrics({ quality: 'healthy', fixCount: 1 }) });
  expect(journalQualityFlags(partial)).toEqual(['partial', 'no_track']);
  expect(journalQualityFlags(flight({ status: 'processing', metrics: metrics({ quality: 'gaps' }) }))).toEqual(['unknown']);
  expect(journalQualityFlags(archive({ status: 'partial', metrics: null }))).toEqual(['partial', 'unknown']);
  expect(journalQualityFlags(flight({ metrics: metrics({ quality: 'gaps' }) }))).toEqual(['gaps']);
  expect(selectJournal([partial], criteria({ qualities: ['partial', 'no_track'] })).matchedCount).toBe(1);
  expect(journalQualityExplanation(partial)).toContain('saved recording');
  expect(journalQualityExplanation(partial)).not.toMatch(/stopp|early/);
  expect(journalQualityExplanation(flight({ status: 'processing' }))).toContain('prepared');
  expect(journalQualityExplanation(archive({ metrics: null }))).toContain('unavailable');
  expect(journalQualityExplanation(flight({ metrics: metrics({ quality: 'gaps' }) }))).toContain('route and distance');
  expect(journalQualityExplanation(flight())).toBeNull();
});

it('preserves a restored partial status through missing statistics in filters and card explanations', () => {
  const partial = archive({ status: 'partial', metrics: null });
  expect(journalQualityFlags(partial)).toEqual(['partial', 'unknown']);
  expect(selectJournal([partial], criteria({ qualities: ['partial'] })).matchedCount).toBe(1);
  expect(selectJournal([partial], criteria({ qualities: ['unknown'] })).matchedCount).toBe(1);
  expect(journalQualityExplanation(partial)).toContain('partial recording');
  expect(journalQualityExplanation(partial)).toContain('statistics are unavailable');
  expect(journalFlightMetrics(partial)).toEqual({ durationMs: null, distanceMetres: null });
  expect(journalQualityFlags(flight({ status: 'processing', metrics: null }))).toEqual(['unknown']);
});

it('sorts numeric measurements descending with unknowns last and stable time/identity ties', () => {
  const flights = [flight({ id: 'missing', startedAt: 9000, metrics: null }),
    flight({ id: 'b', startedAt: 2000, metrics: metrics({ durationMs: 20, trackDistanceMetres: 5 }) }),
    flight({ id: 'a', startedAt: 2000, metrics: metrics({ durationMs: 20, trackDistanceMetres: 5 }) }),
    flight({ id: 'long', startedAt: 1000, metrics: metrics({ durationMs: 30, trackDistanceMetres: 1 }) }),
    flight({ id: 'far', startedAt: 3000, metrics: metrics({ durationMs: 10, trackDistanceMetres: 50 }) })];
  const duration = selectJournal(flights, criteria({ sort: 'duration' }));
  expect(ids(duration.flights)).toEqual(['long', 'a', 'b', 'far', 'missing']);
  expect(duration.sections).toHaveLength(1);
  expect(duration.sections[0]!.title).toBe('Longest recorded time');
  expect(ids(selectJournal(flights, criteria({ sort: 'distance' })).flights)).toEqual(['far', 'a', 'b', 'long', 'missing']);
  expect(ids(selectJournal(flights, criteria({ sort: 'oldest' })).flights)).toEqual(['long', 'a', 'b', 'far', 'missing']);
  expect(ids(selectJournal(flights, criteria()).flights)).toEqual(['missing', 'far', 'a', 'b', 'long']);
});

it('keeps chronological order and unique section keys when saved timezones revisit a calendar month', () => {
  const boundary = Date.UTC(2026, 7, 31, 23);
  const flights = [flight({ id: '1', startedAt: boundary + 2000, timezoneOffsetMinutes: -120 }),
    flight({ id: '2', startedAt: boundary + 1000, timezoneOffsetMinutes: 300 }),
    flight({ id: '3', startedAt: boundary, timezoneOffsetMinutes: -120 })];
  const result = selectJournal(flights, criteria());
  expect(ids(result.sections.flatMap(section => section.flights))).toEqual(['1', '2', '3']);
  expect(new Set(result.sections.map(section => section.key)).size).toBe(result.sections.length);
  expect(result.sections.map(section => section.title)).toEqual(['September 2026', 'August 2026', 'September 2026']);
});

it('retains selected options after their last matching flight is removed, with removable filter chips', () => {
  const applied = criteria({ sites: ['site:gone'], sports: ['hang_gliding'], aircraft: ['deleted-aircraft'], year: 2020, qualities: ['gaps'], sort: 'distance' });
  const result = selectJournal([], applied);
  expect(result.facets.aircraft).toEqual([{ value: 'deleted-aircraft', label: 'Unavailable aircraft' }]);
  expect(result.facets.years).toEqual([{ value: '2020', label: '2020' }]);
  const chips = journalFilterChips(applied, result.facets);
  expect(chips).toHaveLength(5);
  expect(activeFilterCount(applied)).toBe(5);
  expect(removeJournalFilter(applied, chips.find(chip => chip.category === 'year')!)).toMatchObject({ year: null, sort: 'distance' });
  expect(removeJournalFilter(applied, chips.find(chip => chip.category === 'aircraft')!)).toMatchObject({ aircraft: [], sites: ['site:gone'] });
  expect(applied.aircraft).toEqual(['deleted-aircraft']);
  expect(activeFilterCount(criteria({ sort: 'duration' }))).toBe(0);
  expect(activeFilterCount(criteria({ sites: ['site:north', 'site:south'], sports: ['paragliding', 'hang_gliding'], aircraft: ['a', 'b'] }))).toBe(3);
});

it('does not mutate frozen input criteria, flights, snapshots, or their order', () => {
  const recorded = flight({ id: 'b', equipmentSnapshot: Object.freeze(snapshot()) });
  const flights = Object.freeze([Object.freeze(recorded), Object.freeze(flight({ id: 'a' }))]);
  const applied = Object.freeze({ ...criteria(), sites: Object.freeze([]) }) as unknown as JournalCriteria;
  selectJournal(flights, applied);
  expect(ids(flights)).toEqual(['b', 'a']);
  expect(defaultJournalCriteria().aircraft).not.toBe(defaultJournalCriteria().aircraft);
});

it('computes complete results and facets for a large journal without truncating totals to visible rows', () => {
  const flights = Array.from({ length: 12_000 }, (_, index) => flight({ id: String(index).padStart(5, '0'), startedAt: index * 1000,
    site: index % 2 ? 'North' : 'South', metrics: metrics({ durationMs: 1000, trackDistanceMetres: index }),
    equipmentSnapshot: snapshot({ aircraftId: `aircraft-${index}`, model: `Model ${index}` }) }));
  const result = selectJournal(flights, criteria({ sites: ['site:north'], sort: 'distance' }));
  expect(result).toMatchObject({ totalCount: 12_000, matchedCount: 6000, summary: {
    flightCount: 6000, recordedTimeMs: 6_000_000, timeCount: 6000, distanceCount: 6000, longestDistanceMetres: 11_999,
  } });
  expect(result.facets.aircraft).toHaveLength(12_000);
  expect(result.sections.flatMap(section => section.flights)).toHaveLength(6000);
});
