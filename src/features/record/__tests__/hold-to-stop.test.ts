import React from 'react';
import { AccessibilityInfo, Alert, Animated } from 'react-native';
import { HoldToStop } from '../components/hold-to-stop';
import { act, create } from '../../../../tests/support/renderer';

let root: ReturnType<typeof create>;
const onConfirm = jest.fn();
const control = () => root.root.findAllByProps({ accessibilityRole: 'button', accessibilityLabel: 'Stop recording' })[0].props;
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: jest.fn() } as unknown as ReturnType<typeof AccessibilityInfo.addEventListener>);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});
afterEach(async () => { await act(async () => root?.unmount()); jest.restoreAllMocks(); });

it('ignores a delayed hold completion after leaving the foreground or unmounting', async () => {
  let finish!: (result: { finished: boolean }) => void;
  jest.spyOn(Animated, 'timing').mockImplementation(() => ({
    start: (callback) => { finish = callback!; }, stop: jest.fn(), reset: jest.fn(),
  }));
  await act(async () => { root = create(React.createElement(HoldToStop, { onConfirm })); });
  await act(async () => { control().onPressIn(); });
  const firstFinish = finish;
  await act(async () => root.update(React.createElement(HoldToStop, { onConfirm, disabled: true })));
  await act(async () => firstFinish({ finished: true }));
  expect(onConfirm).not.toHaveBeenCalled();
  await act(async () => root.update(React.createElement(HoldToStop, { onConfirm, disabled: false })));
  await act(async () => { control().onPressIn(); });
  await act(async () => root.unmount());
  await act(async () => finish({ finished: true }));
  expect(onConfirm).not.toHaveBeenCalled();
});

it('cancels a screen-reader confirmation when its recording control is gone', async () => {
  jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockResolvedValue(true);
  await act(async () => { root = create(React.createElement(HoldToStop, { onConfirm })); });
  await act(async () => { control().onLongPress(); });
  const accept = jest.mocked(Alert.alert).mock.calls.at(-1)![2]!.find((button) => button.text === 'Stop and save')!.onPress!;
  await act(async () => root.unmount());
  accept();
  expect(onConfirm).not.toHaveBeenCalled();
});

it('confirms once through the active screen-reader dialog', async () => {
  jest.mocked(AccessibilityInfo.isScreenReaderEnabled).mockResolvedValue(true);
  await act(async () => { root = create(React.createElement(HoldToStop, { onConfirm })); });
  await act(async () => { control().onLongPress(); });
  const accept = jest.mocked(Alert.alert).mock.calls.at(-1)![2]!.find((button) => button.text === 'Stop and save')!.onPress!;
  accept(); accept();
  expect(onConfirm).toHaveBeenCalledTimes(1);
});
