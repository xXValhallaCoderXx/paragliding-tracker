import React, { useEffect } from 'react';
import { AccessibilityInfo } from 'react-native';

import { useReducedMotion } from '../use-reduced-motion';

import { create, act } from '../../../tests/support/renderer';

let rendered: { unmount: () => void } | undefined;
let current: boolean;
let change: (value: boolean) => void;
let resolveRead: (value: boolean) => void;
let rejectRead: (reason: Error) => void;
const remove = jest.fn();

function Consumer() {
  const reduced = useReducedMotion();
  useEffect(() => { current = reduced; }, [reduced]);
  return null;
}

beforeEach(async () => {
  remove.mockClear();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => new Promise((resolve, reject) => {
    resolveRead = resolve;
    rejectRead = reject;
  }));
  // Narrow RN's overloaded event API to the boolean event used by this hook.
  const listen = jest.spyOn(AccessibilityInfo, 'addEventListener') as jest.Mock;
  listen.mockImplementation((_event: string, listener: (value: boolean) => void) => {
    change = listener;
    return { remove };
  });
  await act(async () => { rendered = create(React.createElement(Consumer)); });
});

afterEach(async () => {
  if (rendered) await act(async () => rendered!.unmount());
  rendered = undefined;
  jest.restoreAllMocks();
});

it('starts with reduced motion until the native preference is available', async () => {
  expect(current).toBe(true);
  await act(async () => resolveRead(false));
  expect(current).toBe(false);
  await act(async () => change(true));
  expect(current).toBe(true);
});

it('does not let a late initial read overwrite a newer accessibility change', async () => {
  await act(async () => change(true));
  await act(async () => resolveRead(false));
  expect(current).toBe(true);
});

it('keeps reduced motion if the native read fails', async () => {
  await act(async () => rejectRead(new Error('unavailable')));
  expect(current).toBe(true);
});

it('removes the listener and ignores a read arriving after unmount', async () => {
  await act(async () => rendered!.unmount());
  rendered = undefined;
  expect(remove).toHaveBeenCalledTimes(1);
  await act(async () => resolveRead(false));
  expect(current).toBe(true);
});
