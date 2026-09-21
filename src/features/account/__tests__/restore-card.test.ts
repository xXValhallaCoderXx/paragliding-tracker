import React from 'react';
import { Switch } from 'react-native';

import { Button } from '@/components/ui';
import { EMPTY_RESTORE, type RestoreSnapshot } from '@/cloud/restore-plan';
import { RestoreCard } from '../components/restore-card';
import { act, create } from '../../../../tests/support/renderer';

jest.mock('@/components/ui', () => ({
  Button: jest.fn(() => null), Notice: () => null,
  Card: ({ children }: { children: React.ReactNode }) => children,
}));
const onPause = jest.fn(), onResume = jest.fn(), onRetry = jest.fn();
let rendered: { unmount: () => void; root: { findByType: (type: unknown) => { props: { value: boolean; onValueChange: (value: boolean) => void } } } };
const button = (label: string) => jest.mocked(Button).mock.calls.map(([props]) => props).filter((props) => props.label === label).at(-1)!;
async function mount(restore: Partial<RestoreSnapshot>) {
  await act(async () => { rendered = create(React.createElement(RestoreCard, {
    restore: { ...EMPTY_RESTORE, phase: 'paused', pauseReason: 'user', ...restore }, onPause, onResume, onRetry,
  })); });
}
beforeEach(() => jest.clearAllMocks());
afterEach(async () => { await act(async () => rendered.unmount()); });

it('defaults resume to Wi-Fi and scopes explicit mobile consent to one action', async () => {
  await mount({});
  expect(rendered.root.findByType(Switch).props.value).toBe(false);
  await act(async () => button('Resume restoration').onPress());
  expect(onResume).toHaveBeenLastCalledWith({ allowMobileData: false });
  await act(async () => rendered.root.findByType(Switch).props.onValueChange(true));
  await act(async () => button('Resume restoration').onPress());
  expect(onResume).toHaveBeenLastCalledWith({ allowMobileData: true });
  expect(rendered.root.findByType(Switch).props.value).toBe(false);
});

it('exposes retry after a failed download without silently enabling mobile data', async () => {
  await mount({ phase: 'error', pauseReason: null, lastError: 'Download failed' });
  await act(async () => button('Retry restoration').onPress());
  expect(onRetry).toHaveBeenCalledWith({ allowMobileData: false });
});

it.each(['recording', 'recovering', 'offline'] as const)('keeps resume unavailable while %s', async (pauseReason) => {
  await mount({ pauseReason });
  expect(button('Resume restoration').disabled).toBe(true);
  expect(onResume).not.toHaveBeenCalled();
});

it('offers pause during an active restore', async () => {
  await mount({ phase: 'restoring', pauseReason: null, total: 3, completed: 1 });
  await act(async () => button('Pause restoration').onPress());
  expect(onPause).toHaveBeenCalledTimes(1);
});
