import { useDispatch, useSelector } from 'react-redux';

import type { AppDispatch, RootState } from './index';

/**
 * Typed `useDispatch` / `useSelector`, so call sites never need a generic argument.
 */
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();

/** Re-exported so screens have one import for the store's hooks and its guards. */
export { DATA_AVAILABLE } from './query-fn';
