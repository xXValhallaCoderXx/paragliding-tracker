import React from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { ReplayTimeline } from '../replay/replay-timeline';

import { create, act } from '../../../../tests/support/renderer';
type Rendered = {
  root: { findAllByType: (type: unknown) => { props: ViewProps }[] };
  unmount: () => void;
};
const durationMs = 12 * 60 * 60 * 1000;
let rendered: Rendered;
const onSeek = jest.fn();
const onScrubbing = jest.fn();
const timeline = () => rendered.root.findAllByType(View).find(({ props }) => props.accessibilityRole === 'adjustable')!.props;
const touch = (locationX: number) => ({ nativeEvent: { locationX } }) as Parameters<NonNullable<ViewProps['onResponderGrant']>>[0];
async function mount(elapsedMs: number) {
  await act(async () => { rendered = create(React.createElement(ReplayTimeline, { elapsedMs, durationMs, onSeek, onScrubbing })); });
  await act(async () => timeline().onLayout!({ nativeEvent: { layout: { width: 300, height: 52, x: 0, y: 0 } } } as Parameters<NonNullable<ViewProps['onLayout']>>[0]));
}
beforeEach(() => jest.clearAllMocks());
afterEach(async () => { if (rendered) await act(async () => rendered.unmount()); });

it.each([0, durationMs / 4, durationMs / 2, durationMs])('grabbing the visible thumb at %i ms does not jump along a long flight', async (elapsedMs) => {
  await mount(elapsedMs);
  const thumb = rendered.root.findAllByType(View).map(({ props }) => StyleSheet.flatten(props.style)).find((style) => style?.position === 'absolute')!;
  const centreX = Number(thumb.left) + Number(thumb.width) / 2;
  timeline().onResponderGrant!(touch(centreX));
  expect(onSeek).toHaveBeenLastCalledWith(elapsedMs);
  expect(onScrubbing).toHaveBeenLastCalledWith(true);
});

it('clamps drags at both ends and records the final release position', async () => {
  await mount(0);
  timeline().onResponderGrant!(touch(-100));
  expect(onSeek).toHaveBeenLastCalledWith(0);
  timeline().onResponderMove!(touch(500));
  expect(onSeek).toHaveBeenLastCalledWith(durationMs);
  timeline().onResponderRelease!(touch(150));
  expect(onSeek).toHaveBeenLastCalledWith(durationMs / 2);
  expect(onScrubbing).toHaveBeenLastCalledWith(false);
});

it('releases scrolling on responder cancellation without changing the selected time', async () => {
  await mount(0);
  timeline().onResponderGrant!(touch(150));
  timeline().onResponderTerminate!(touch(0));
  expect(onSeek).toHaveBeenCalledTimes(1);
  expect(onSeek).toHaveBeenLastCalledWith(durationMs / 2);
  expect(onScrubbing).toHaveBeenLastCalledWith(false);
});

it('exposes elapsed time and ten-second adjustable accessibility actions', async () => {
  await mount(30_000);
  expect(timeline().accessibilityValue).toMatchObject({ min: 0, max: 43_200, now: 30, text: '0:00:30 of 12:00:00' });
  const action = (actionName: string) => ({ nativeEvent: { actionName } }) as Parameters<NonNullable<ViewProps['onAccessibilityAction']>>[0];
  timeline().onAccessibilityAction!(action('increment'));
  expect(onSeek).toHaveBeenLastCalledWith(40_000);
  timeline().onAccessibilityAction!(action('decrement'));
  expect(onSeek).toHaveBeenLastCalledWith(20_000);
});
