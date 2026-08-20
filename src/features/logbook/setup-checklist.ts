import type { PilotProfile, RecorderCapabilities } from '@/recorder/types';

/**
 * The "two things before you fly" card, shown on a logbook whose owner skipped setup.
 *
 * Only ever offered to someone who took "Skip setup" — a pilot who stepped through and
 * chose to leave a field blank was already asked, and asking again would be nagging.
 * Nothing here blocks anything: every item is a link, never a gate.
 */

export type ChecklistKey = 'location' | 'pilotName' | 'glider';

export interface ChecklistItem {
  key: ChecklistKey;
  label: string;
  /** Why it matters, in the pilot's terms. Empty once the item is done. */
  detail: string;
  done: boolean;
}

export interface SetupChecklist {
  title: string;
  /** "1 OF 3 DONE" */
  progressLabel: string;
  items: ChecklistItem[];
  done: number;
  total: number;
}

const COUNT_WORDS = ['No', 'One', 'Two', 'Three'] as const;

function countWord(count: number): string {
  return COUNT_WORDS[count] ?? String(count);
}

/**
 * Background permission is the one that matters: foreground alone still stops the track
 * the moment the screen locks, which the pilot would only discover after landing.
 */
function locationDone(capabilities: RecorderCapabilities): boolean {
  return capabilities.foregroundPermission === 'granted' && capabilities.backgroundPermission === 'granted';
}

export function setupChecklist(args: {
  profile: PilotProfile;
  capabilities: RecorderCapabilities;
}): SetupChecklist | null {
  const { profile, capabilities } = args;

  const items: ChecklistItem[] = [
    {
      key: 'location',
      label: locationDone(capabilities) ? 'Location allowed' : 'Allow location',
      detail: locationDone(capabilities)
        ? ''
        : 'Without it the track stops when the screen locks',
      done: locationDone(capabilities),
    },
    {
      key: 'pilotName',
      label: profile.pilotName ? 'Pilot name added' : 'Add your pilot name',
      detail: profile.pilotName ? '' : 'IGC files say UNSPECIFIED until you do',
      done: Boolean(profile.pilotName),
    },
    {
      key: 'glider',
      label: profile.gliderType ? 'Glider named' : 'Name your glider',
      detail: profile.gliderType ? '' : 'Pre-fills every flight you save',
      done: Boolean(profile.gliderType),
    },
  ];

  const done = items.filter((item) => item.done).length;
  const outstanding = items.length - done;
  if (outstanding === 0) return null;

  return {
    title: `${countWord(outstanding)} thing${outstanding === 1 ? '' : 's'} before you fly`,
    progressLabel: `${done} OF ${items.length} DONE`,
    items,
    done,
    total: items.length,
  };
}
