import React from 'react';
import { Text } from 'react-native';
import { Button, Notice } from '@/components/ui';
import type { OfflineRegion } from '@/offline-maps/types';
import { act, create } from '../../../../tests/support/renderer';
import { SavedRegion } from '../saved-region';

jest.mock('@/components/ui', () => ({
  Button: jest.fn(() => null), LinkButton: jest.fn(() => null), Meter: jest.fn(() => null), Notice: jest.fn(() => null),
  Card: ({ children }: { children: React.ReactNode }) => children,
}));

const region: OfflineRegion = {
  id: 'jugra', spec: { id: 'jugra-area', name: 'Around Jugra', context: 'Selangor, Malaysia', center: [101, 3],
    bounds: [100.8, 2.8, 101.2, 3.2], styleURL: 'mapbox://styles/mapbox/outdoors-v12', minZoom: 0, maxZoom: 14, attribution: 'OSM' },
  status: 'deleting', available: true, activeNativeId: 'jugra-ready', pendingNativeId: null, obsoleteNativeIds: [],
  operationId: null, completedAt: null, progress: null, error: null, pauseReason: null, allowMobileData: false,
};
type Rendered = { root: { findAllByType: (type: unknown) => { props: Record<string, any> }[] };
  update: (element: React.ReactElement) => void; unmount: () => void };

it('shows deferred deletion without an endless busy button and makes a failed delete retryable', async () => {
  const onRemove = jest.fn();
  const callbacks = { onRemove, onPause: jest.fn(), onCancel: jest.fn(), onResume: jest.fn(), onUpdate: jest.fn() };
  let rendered!: Rendered;
  await act(async () => { rendered = create(React.createElement(SavedRegion, { region, busy: false, ...callbacks })); });
  try {
    expect(rendered.root.findAllByType(Text).some((node) => node.props.children === 'Deletion pending')).toBe(true);
    expect(rendered.root.findAllByType(Notice).some((node) => String(node.props.children).includes('recorder is ready and idle'))).toBe(true);
    expect(rendered.root.findAllByType(Button)).toHaveLength(0);
    expect(onRemove).not.toHaveBeenCalled();

    const failed = { ...region, error: { code: 'io', message: 'Map storage could not be updated.' } };
    await act(async () => rendered.update(React.createElement(SavedRegion, { region: failed, busy: false, ...callbacks })));
    const retry = rendered.root.findAllByType(Button).find((node) => node.props.label === 'Retry delete')!.props;
    expect(retry.disabled).toBe(false);
    expect(retry.busy).toBeUndefined();
    await act(async () => retry.onPress());
    expect(onRemove).toHaveBeenCalledTimes(1);

    await act(async () => rendered.update(React.createElement(SavedRegion, { region: failed, busy: true, ...callbacks })));
    expect(rendered.root.findAllByType(Button).find((node) => node.props.label === 'Retry delete')!.props.disabled).toBe(true);
  } finally { await act(async () => rendered.unmount()); }
});
