import { useDispatch, useSelector } from 'react-redux';

import type { AppDispatch, RootState } from './index';

/**
 * Typed `useDispatch` / `useSelector`, so call sites never need a generic argument.
 */
export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
