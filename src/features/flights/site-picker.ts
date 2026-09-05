import { isSearchable, MINIMUM_QUERY_LENGTH } from '@/sites/site-plan';

/**
 * When the launch picker is open, and what it is showing.
 *
 * It had no notion of being open at all: the list rendered whenever a query returned
 * anything, so opening a flight that already had a site name fired a search for that very
 * name and dropped a list of near-identical matches under a field the pilot had already
 * filled in. Picking one could not close it either, because the pick set the field text,
 * which is the same signal that opened it.
 *
 * So opening became something the pilot does, and the trigger is kept rather than reduced to
 * a boolean — because *why* the panel opened decides what it should show. Focusing a field
 * that already reads "Bukit Jugra" must not search for Bukit Jugra; that is the original
 * annoyance with one extra tap in front of it.
 */
export type SitePickerTrigger = 'none' | 'focus' | 'typing' | 'nearby';

export type SitePickerMode = 'closed' | 'nearby' | 'search';

export interface SitePickerInput {
  /** Current text in the Site field. */
  query: string;
  /** The same text, debounced. Only this is worth spending a request on. */
  debouncedQuery: string;
  /** What the pilot last did. `none` covers both "has not touched it" and "is done". */
  trigger: SitePickerTrigger;
  /** Is there a position to look around — the flight's launch, or a live read. */
  hasPosition: boolean;
  /** How many suggestions are in hand right now. */
  resultCount: number;
  /** Is a lookup in flight. */
  fetching: boolean;
}

export interface SitePickerView {
  mode: SitePickerMode;
  open: boolean;
  /** Panel heading, which is also what tells the pilot why these particular places. */
  title: string;
  /** What the panel says instead of a list. Null when there are results to show. */
  empty: string | null;
  busy: boolean;
  /** Whether to send a name search for the debounced text. */
  shouldSearch: boolean;
  /** Whether to ask the catalogue for launches near the position. */
  shouldLookNearby: boolean;
  /**
   * The way back in once the panel is closed. `locate` when there is no position to search
   * around yet, so the offer is to find one rather than to open an empty list.
   */
  reopen: 'nearby' | 'locate' | null;
}

const CLOSED: Omit<SitePickerView, 'reopen'> = {
  mode: 'closed',
  open: false,
  title: '',
  empty: null,
  busy: false,
  shouldSearch: false,
  shouldLookNearby: false,
};

function modeFor(input: SitePickerInput): SitePickerMode {
  const typed = input.query.trim().length > 0;
  switch (input.trigger) {
    case 'none':
      return 'closed';
    case 'nearby':
      return input.hasPosition ? 'nearby' : 'closed';
    case 'typing':
      // Typing beats proximity: a pilot naming a place has one in mind, and launches near
      // here have stopped being the answer to their question. Clearing the field asks the
      // opposite question, so it falls back to nearby.
      return typed ? 'search' : input.hasPosition ? 'nearby' : 'closed';
    case 'focus':
      // Focus alone opens nothing over text the pilot has not touched — they are far more
      // likely to be editing a name than asking to search for the one already there.
      return typed ? 'closed' : input.hasPosition ? 'nearby' : 'closed';
  }
}

export function sitePickerView(input: SitePickerInput): SitePickerView {
  const mode = modeFor(input);

  if (mode === 'closed') {
    return { ...CLOSED, reopen: input.hasPosition ? 'nearby' : 'locate' };
  }

  const searchable = isSearchable(input.debouncedQuery);
  // A stale list from the previous keystroke is worse than no list: it invites a tap on a
  // place that has nothing to do with what is now in the field.
  const settling = mode === 'search' && input.debouncedQuery.trim() !== input.query.trim();
  const busy = input.fetching || settling;

  return {
    mode,
    open: true,
    title: mode === 'nearby' ? 'Nearby launches' : 'Matching places',
    empty: emptyMessage(mode, input, searchable, busy),
    busy,
    shouldSearch: mode === 'search' && searchable,
    shouldLookNearby: mode === 'nearby',
    reopen: null,
  };
}

function emptyMessage(
  mode: SitePickerMode,
  input: SitePickerInput,
  searchable: boolean,
  busy: boolean,
): string | null {
  if (input.resultCount > 0) return null;
  if (busy) return null;
  if (mode === 'search' && !searchable) {
    return `Type at least ${MINIMUM_QUERY_LENGTH} letters to search.`;
  }
  if (mode === 'search') {
    // Never phrased as a failure. Coverage outside Europe is genuinely thin, and the field
    // underneath is still a perfectly good text box.
    return 'No launches found by that name. Your own name works fine.';
  }
  return 'No launches catalogued near here yet.';
}

/**
 * The line under the field once the panel has gone.
 *
 * Credits the catalogue a picked name came from, and confirms the pick landed — which is the
 * feedback a list that simply vanished would otherwise owe the pilot.
 */
export function siteFieldHint(siteSource: string | null, view: SitePickerView): string | null {
  if (view.open) return null;
  return siteAttribution(siteSource) ?? 'Pick a launch, or type any name.';
}

export function siteAttribution(siteSource: string | null): string | null {
  if (siteSource === 'paraglidingearth') return 'From ParaglidingEarth (CC BY-SA 3.0)';
  if (siteSource === 'osm') return 'From OpenStreetMap (ODbL)';
  return null;
}
