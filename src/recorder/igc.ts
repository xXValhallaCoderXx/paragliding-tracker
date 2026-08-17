import type { LocationFixRecord, SessionRecord } from './types';

export interface IgcBuildResult {
  content: string;
  eligibleFixes: LocationFixRecord[];
  bRecordCount: number;
}

function isIgcAltitude(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= -9999 && value <= 99999;
}

export function isExportEligibleFix(fix: LocationFixRecord): boolean {
  return (
    Number.isFinite(fix.sourceTimestamp) &&
    Number.isFinite(fix.latitude) &&
    fix.latitude >= -90 &&
    fix.latitude <= 90 &&
    Number.isFinite(fix.longitude) &&
    fix.longitude >= -180 &&
    fix.longitude <= 180 &&
    !fix.mocked &&
    isIgcAltitude(fix.gpsAltitude)
  );
}

export function selectExportEligibleFixes(
  fixes: LocationFixRecord[],
  window?: Pick<SessionRecord, 'startedAt' | 'endedAt'>,
): LocationFixRecord[] {
  const ordered = fixes
    .filter(
      (fix) =>
        isExportEligibleFix(fix) &&
        (!window ||
          (fix.sourceTimestamp >= window.startedAt &&
            (window.endedAt === null || fix.sourceTimestamp <= window.endedAt))),
    )
    .sort(
      (left, right) =>
        left.sourceTimestamp - right.sourceTimestamp || left.sequence - right.sequence,
    );
  const seenSeconds = new Set<number>();
  return ordered.filter((fix) => {
    const second = Math.floor(fix.sourceTimestamp / 1000);
    if (seenSeconds.has(second)) return false;
    seenSeconds.add(second);
    return true;
  });
}

export function formatIgcCoordinate(
  value: number,
  axis: 'latitude' | 'longitude',
): string {
  const limit = axis === 'latitude' ? 90 : 180;
  if (!Number.isFinite(value) || value < -limit || value > limit) {
    throw new RangeError(`Invalid ${axis}: ${value}`);
  }

  const degreeWidth = axis === 'latitude' ? 2 : 3;
  const negative = value < 0 || Object.is(value, -0);
  let degrees = Math.floor(Math.abs(value));
  let minuteThousandths = Math.round((Math.abs(value) - degrees) * 60_000);
  if (minuteThousandths === 60_000) {
    degrees += 1;
    minuteThousandths = 0;
  }
  if (degrees > limit || (degrees === limit && minuteThousandths !== 0)) {
    throw new RangeError(`Rounded ${axis} exceeds its valid boundary.`);
  }

  const hemisphere =
    axis === 'latitude' ? (negative ? 'S' : 'N') : negative ? 'W' : 'E';
  return `${String(degrees).padStart(degreeWidth, '0')}${String(minuteThousandths).padStart(5, '0')}${hemisphere}`;
}

export function formatIgcAltitude(value: number): string {
  const rounded = Math.round(value);
  if (rounded < -9999 || rounded > 99999) {
    throw new RangeError(`Altitude ${value} cannot fit in an IGC B record.`);
  }
  return rounded < 0
    ? `-${String(Math.abs(rounded)).padStart(4, '0')}`
    : String(rounded).padStart(5, '0');
}

function formatUtcTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getUTCHours()).padStart(2, '0')}${String(date.getUTCMinutes()).padStart(2, '0')}${String(date.getUTCSeconds()).padStart(2, '0')}`;
}

function formatUtcDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getUTCDate()).padStart(2, '0')}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCFullYear() % 100).padStart(2, '0')}`;
}

function formatAccuracy(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return '999';
  return String(Math.min(999, Math.round(value))).padStart(3, '0');
}

function sessionIdentifier(sessionId: string): string {
  return sessionId.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 6).padEnd(6, '0');
}

export function buildUnsignedIgc(
  session: Pick<SessionRecord, 'id' | 'startedAt' | 'endedAt'>,
  fixes: LocationFixRecord[],
): IgcBuildResult {
  const eligibleFixes = selectExportEligibleFixes(fixes, session);
  if (eligibleFixes.length === 0) {
    throw new Error('No export-eligible GPS fixes are available for this session.');
  }

  const firstTimestamp = eligibleFixes[0]!.sourceTimestamp;
  const lines = [
    `AXCL${sessionIdentifier(session.id)}`,
    `HFDTE${formatUtcDate(firstTimestamp)}`,
    'HFFXA999',
    'HFPLTPILOTINCHARGE:UNSPECIFIED',
    'HFCM2CREW2:NOT APPLICABLE',
    'HFGTYGLIDERTYPE:PARAGLIDER',
    'HFGIDGLIDERID:UNSPECIFIED',
    'HFDTM100GPSDATUM:WGS-84',
    'HFRFWFIRMWAREVERSION:1.0.0',
    'HFRHWHARDWAREVERSION:CONSUMER DEVICE',
    'HFFTYFRTYPE:FLIGHT LOG ALPHA,DIAGNOSTIC UNSIGNED',
    'HFGPS:DEVICE GNSS,INTERNAL,0,18000',
    'HFPRSPRESSALTSENSOR:NIL',
    'HFALPNIL',
    'HFALGELL',
    'I013638FXA',
  ];

  for (const fix of eligibleFixes) {
    lines.push(
      `B${formatUtcTime(fix.sourceTimestamp)}` +
        formatIgcCoordinate(fix.latitude, 'latitude') +
        formatIgcCoordinate(fix.longitude, 'longitude') +
        'A' +
        '00000' +
        formatIgcAltitude(fix.gpsAltitude!) +
        formatAccuracy(fix.horizontalAccuracy),
    );
  }

  return {
    content: `${lines.join('\r\n')}\r\n`,
    eligibleFixes,
    bRecordCount: eligibleFixes.length,
  };
}
