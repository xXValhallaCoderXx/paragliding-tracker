import { createContext } from 'react';
import type { OfflineEnvironment, OfflineRegion } from './types';

/** Lightweight view context: importing the map renderer must not initialize services. */
export const OfflineCoverageContext = createContext<{
  regions: readonly OfflineRegion[];
  network: OfflineEnvironment['network'];
  activate(): void;
} | null>(null);
