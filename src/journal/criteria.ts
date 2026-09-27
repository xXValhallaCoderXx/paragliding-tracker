/** Serializable, in-memory journal preferences shared by the selector and app store. */
export type JournalQuality = 'healthy' | 'gaps' | 'partial' | 'no_track' | 'unknown';
export type JournalSort = 'newest' | 'oldest' | 'duration' | 'distance';
export interface JournalCriteria {
  sites: string[];
  sports: string[];
  aircraft: string[];
  year: number | null;
  qualities: JournalQuality[];
  sort: JournalSort;
}

export function defaultJournalCriteria(): JournalCriteria {
  return { sites: [], sports: [], aircraft: [], year: null, qualities: [], sort: 'newest' };
}
