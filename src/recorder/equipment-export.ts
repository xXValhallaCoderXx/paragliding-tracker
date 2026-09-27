import type { FlightEquipmentSnapshot } from '@/equipment/types';
import { sanitizeIgcHeaderValue, type IgcPilotHeaders } from './igc';
import type { PilotProfile } from './types';

/** Equipment is evidence captured at Start; the editable pilot name retains its export-time behavior. */
export function equipmentExportHeaders(
  equipment: FlightEquipmentSnapshot | null | undefined,
  pilot: Pick<PilotProfile, 'pilotName'> | null | undefined,
): IgcPilotHeaders {
  return {
    pilotName: pilot?.pilotName ?? null,
    gliderType: sanitizeIgcHeaderValue(equipment?.model) ?? 'UNSPECIFIED',
    gliderId: sanitizeIgcHeaderValue(equipment?.registrationId) ?? 'UNSPECIFIED',
  };
}

/** Content addressing preserves earlier exports when a new export changes its pilot name. */
export function exportFilename(sessionId: string, version: number, sha256: string, extension: string): string {
  const safeSessionId = sessionId.replace(/[^a-z0-9-]/gi, '');
  return `${safeSessionId}-v${version}-${sha256}.${extension}`;
}
