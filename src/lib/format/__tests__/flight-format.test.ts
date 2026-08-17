import {
  flightHeadline,
  flightLocalDate,
  flightMonthKey,
  formatAirtime,
  formatAirtimeShort,
  formatAirtimeWords,
  formatBattery,
  formatClockTime,
  formatDayLabel,
  formatDayPartLabel,
  formatDistance,
  formatDistanceParts,
  formatLongDate,
  formatMetres,
  formatMonthLabel,
  formatThousands,
  formatUtcOffset,
  partOfDay,
  utcOffsetDiffersFromDevice,
} from '../flight-format';

// 2026-08-16T06:42:00Z is 13:42 in UTC+7 (offset -420, as Date#getTimezoneOffset reports it).
const START = Date.UTC(2026, 7, 16, 6, 42, 0);
const UTC_PLUS_7 = -420;

describe('flight-local calendar formatting', () => {
  it('breaks a timestamp into the recorded timezone, not the device timezone', () => {
    expect(flightLocalDate(START, UTC_PLUS_7)).toEqual({
      year: 2026,
      monthIndex: 7,
      day: 16,
      weekdayIndex: 0,
      hours: 13,
      minutes: 42,
    });
    expect(formatClockTime(START, UTC_PLUS_7)).toBe('13:42');
    expect(formatDayLabel(START, UTC_PLUS_7)).toBe('Sun 16 Aug');
    expect(formatLongDate(START, UTC_PLUS_7)).toBe('Sun 16 Aug 2026');
    expect(formatMonthLabel(START, UTC_PLUS_7)).toBe('August 2026');
    expect(flightMonthKey(START, UTC_PLUS_7)).toBe('2026-08');
  });

  it('crosses midnight correctly for far-east and far-west offsets', () => {
    const lateEvening = Date.UTC(2026, 7, 16, 18, 30, 0);
    expect(formatClockTime(lateEvening, -600)).toBe('04:30');
    expect(formatDayLabel(lateEvening, -600)).toBe('Mon 17 Aug');
    expect(formatClockTime(Date.UTC(2026, 7, 16, 3, 0, 0), 300)).toBe('22:00');
    expect(formatDayLabel(Date.UTC(2026, 7, 16, 3, 0, 0), 300)).toBe('Sat 15 Aug');
  });

  it('describes the part of day in plain words', () => {
    expect(partOfDay(START, UTC_PLUS_7)).toBe('afternoon');
    expect(formatDayPartLabel(START, UTC_PLUS_7)).toBe('Sunday afternoon');
    expect(partOfDay(Date.UTC(2026, 7, 16, 0, 30, 0), UTC_PLUS_7)).toBe('morning');
    expect(partOfDay(Date.UTC(2026, 7, 16, 11, 0, 0), UTC_PLUS_7)).toBe('evening');
    expect(partOfDay(Date.UTC(2026, 7, 16, 16, 0, 0), UTC_PLUS_7)).toBe('night');
  });

  it('formats UTC offsets in the direction pilots read them', () => {
    expect(formatUtcOffset(-420)).toBe('UTC+7');
    expect(formatUtcOffset(-330)).toBe('UTC+5:30');
    expect(formatUtcOffset(180)).toBe('UTC−3');
    expect(formatUtcOffset(0)).toBe('UTC');
    expect(utcOffsetDiffersFromDevice(-420, -420)).toBe(false);
    expect(utcOffsetDiffersFromDevice(-420, 0)).toBe(true);
    expect(utcOffsetDiffersFromDevice(null, 0)).toBe(false);
  });
});

describe('durations and numbers', () => {
  it('formats airtime without a leading zero on hours', () => {
    expect(formatAirtime(3 * 3_600_000 + 12 * 60_000 + 4_000)).toBe('3:12:04');
    expect(formatAirtime(48 * 60_000 + 9_000)).toBe('0:48:09');
    expect(formatAirtimeShort(37 * 3_600_000 + 12 * 60_000 + 59_000)).toBe('37:12');
    expect(formatAirtimeWords(3 * 3_600_000 + 12 * 60_000)).toBe('3 h 12');
    expect(formatAirtimeWords(48 * 60_000)).toBe('48 min');
    expect(formatAirtimeWords(2 * 3_600_000)).toBe('2 h');
    expect(formatAirtime(-5)).toBe('0:00:00');
  });

  it('groups thousands with a non-breaking space', () => {
    expect(formatThousands(11_486)).toBe('11\u00A0486');
    expect(formatThousands(2_410.4)).toBe('2\u00A0410');
    expect(formatThousands(999)).toBe('999');
    expect(formatThousands(-1_250)).toBe('−1\u00A0250');
    expect(formatMetres(2_410)).toBe('2\u00A0410\u00A0m');
    expect(formatMetres(null)).toBe('—');
  });

  it('formats distance to one decimal in kilometres', () => {
    expect(formatDistanceParts(52_437)).toEqual({ value: '52.4', unit: 'km' });
    expect(formatDistanceParts(9_140)).toEqual({ value: '9.1', unit: 'km' });
    expect(formatDistanceParts(850)).toEqual({ value: '850', unit: 'm' });
    expect(formatDistance(52_437)).toBe('52.4\u00A0km');
    expect(formatDistance(null)).toBe('—');
    expect(formatDistanceParts(-1)).toBeNull();
  });

  it('formats battery levels from expo-battery fractions', () => {
    expect(formatBattery(0.784)).toBe('78%');
    expect(formatBattery(null)).toBeNull();
    expect(formatBattery(-1)).toBeNull();
  });
});

describe('flightHeadline', () => {
  it('prefers the title, then the site, then a calm time-based name', () => {
    const base = { startedAt: START, timezoneOffsetMinutes: UTC_PLUS_7 };
    expect(flightHeadline({ ...base, title: ' Bubus — afternoon ', site: 'Bukit Bubus' })).toBe(
      'Bubus — afternoon',
    );
    expect(flightHeadline({ ...base, title: '  ', site: 'Bukit Bubus' })).toBe('Bukit Bubus');
    expect(flightHeadline({ ...base, title: null, site: null })).toBe('Sunday afternoon flight');
  });
});
