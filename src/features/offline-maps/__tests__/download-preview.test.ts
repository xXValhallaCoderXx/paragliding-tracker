import React from 'react';
import { Switch } from 'react-native';
import { Button } from '@/components/ui';
import type { OfflineEstimate, OfflineRegionSpec } from '@/offline-maps/types';
import { act, create } from '../../../../tests/support/renderer';
import { DownloadPreview } from '../download-preview';

jest.mock('../coverage-preview', () => ({ CoveragePreview: () => null }));
jest.mock('@/components/ui', () => ({
  Button: jest.fn(() => null), LinkButton: jest.fn(() => null), SectionLabel: jest.fn(() => null), Notice: jest.fn(() => null),
}));

const spec: OfflineRegionSpec = { id: 'jugra', name: 'Around Jugra', context: 'Selangor, Malaysia', center: [101, 3],
  bounds: [100.8, 2.8, 101.2, 3.2], styleURL: 'mapbox://styles/mapbox/outdoors-v12', minZoom: 0, maxZoom: 14, attribution: 'OSM' };
const estimated: OfflineEstimate = { transferBytes: 2_000_000, storageBytes: 3_000_000, errorMargin: 0.05 };
type Rendered = { root: { findByType: (type: unknown) => { props: Record<string, any> }; findAllByType: (type: unknown) => { props: Record<string, any> }[] }; unmount: () => void };
let rendered: Rendered;
const estimate = jest.fn<Promise<OfflineEstimate>, [OfflineRegionSpec, AbortSignal]>();
const confirm = jest.fn();
const button = (label: string) => rendered.root.findAllByType(Button).find((node) => node.props.label === label)!.props;
async function mount(action: 'download' | 'update' | 'resume' = 'download') {
  await act(async () => { rendered = create(React.createElement(DownloadPreview, { selection: { spec, action, regionId: action === 'download' ? undefined : 'logical-id' },
    estimate, onConfirm: confirm, onBroaderRegion: jest.fn(), onClose: jest.fn() })); });
}
beforeEach(() => { jest.clearAllMocks(); estimate.mockResolvedValue(estimated); confirm.mockResolvedValue(undefined); });
afterEach(async () => { if (rendered) await act(async () => rendered.unmount()); });

it('confirms a measured estimate with Wi-Fi as the default', async () => {
  await mount();
  await act(async () => button('Download area').onPress());
  expect(confirm).toHaveBeenCalledWith({ allowMobileData: false, allowUnknownEstimate: false, estimate: estimated });
});

it('requires the separate unknown-size action after an estimate failure and supports retry', async () => {
  estimate.mockRejectedValueOnce(new Error('Provider unavailable'));
  await mount();
  expect(confirm).not.toHaveBeenCalled();
  expect(button('Download without estimate').disabled).toBe(false);
  await act(async () => button('Retry estimate').onPress());
  expect(estimate).toHaveBeenCalledTimes(2);
  await act(async () => button('Download area').onPress());
  expect(confirm.mock.calls[0]![0].allowUnknownEstimate).toBe(false);
});

it('records mobile and unknown-size consent only after the user explicitly selects them', async () => {
  estimate.mockRejectedValue(new Error('No estimate'));
  await mount();
  await act(async () => rendered.root.findByType(Switch).props.onValueChange(true));
  await act(async () => button('Download without estimate').onPress());
  expect(confirm).toHaveBeenCalledWith({ allowMobileData: true, allowUnknownEstimate: true });
});

it.each(['resume', 'update'] as const)('gets a fresh estimate before %s and rejects duplicate confirmation taps', async (action) => {
  let finish!: () => void;
  confirm.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
  await mount(action);
  expect(estimate).toHaveBeenCalledWith(spec, expect.any(AbortSignal));
  const label = action === 'resume' ? 'Resume area' : 'Update area';
  await act(async () => { button(label).onPress(); button(label).onPress(); });
  expect(confirm).toHaveBeenCalledTimes(1);
  await act(async () => finish());
});

it('cancels the pending estimate when the preview closes', async () => {
  estimate.mockReturnValue(new Promise(() => undefined));
  await mount();
  const signal = estimate.mock.calls[0]![1];
  expect(signal.aborted).toBe(false);
  await act(async () => rendered.unmount());
  expect(signal.aborted).toBe(true);
});
