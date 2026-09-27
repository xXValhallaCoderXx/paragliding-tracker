import type { Aircraft, EquipmentCaptureIntent, EquipmentEntity, EquipmentInventory, Sport } from '@/equipment/types';

export const SPORT_LABELS: Record<Sport, string> = {
  paragliding: 'Paragliding', hang_gliding: 'Hang gliding', speedflying: 'Speedflying',
};
export const AIRCRAFT_LABELS: Record<Sport, string> = {
  paragliding: 'Paraglider', hang_gliding: 'Hang glider', speedflying: 'Speedwing',
};

export function aircraftName(aircraft: Aircraft): string {
  return [aircraft.model, aircraft.size].filter(Boolean).join(' ');
}

export function captureIntent(inventory: EquipmentInventory, aircraft: EquipmentEntity<Aircraft> | null): EquipmentCaptureIntent {
  return aircraft ? { owner: inventory.owner, aircraftId: aircraft.id, expectedGeneration: aircraft.generation }
    : { owner: inventory.owner, aircraftId: null };
}

export function currentAircraft(inventory: EquipmentInventory): EquipmentEntity<Aircraft> | null {
  return inventory.aircraft.find((item) => item.id === inventory.selection.value.aircraftId && !item.value.archived) ?? null;
}
