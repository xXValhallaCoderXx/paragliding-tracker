/**
 * What a logbook with no flights in it promises.
 *
 * The chips are the concrete version of "your first entry writes itself" — they name the things
 * the app will fill in without being asked. Kept pure because jest never collects `.tsx`, so a
 * rule living in the component is a rule nothing checks.
 */

/** A subset of the shared `ChipTone`, so these render through the existing Chip unchanged. */
export type EmptyChipTone = 'muted' | 'good' | 'warning';

export interface EmptyChip {
  key: 'glider' | 'site' | 'location';
  label: string;
  tone: EmptyChipTone;
}

export function emptyLogbookChips(input: {
  gliderType: string | null;
  /** Whether the recorder can actually record — foreground and background both granted. */
  locationReady: boolean;
}): EmptyChip[] {
  const chips: EmptyChip[] = [];

  // Only when there is one. A chip reading "NO GLIDER" would turn a promise into a complaint,
  // and the setup card already covers that when it is owed.
  if (input.gliderType?.trim()) {
    chips.push({ key: 'glider', label: input.gliderType.trim().toUpperCase(), tone: 'muted' });
  }

  // A takeoff position can suggest launches, but the pilot chooses the saved name.
  chips.push({ key: 'site', label: 'CHOOSE YOUR LAUNCH', tone: 'muted' });

  chips.push(
    input.locationReady
      ? { key: 'location', label: 'LOCATION OK', tone: 'good' }
      : // Not an error — the record screen asks properly, and the pilot may simply not have
        // been asked yet. But promising a track without permission would be a lie.
        { key: 'location', label: 'LOCATION NEEDED', tone: 'warning' },
  );

  return chips;
}
