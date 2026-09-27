import React from 'react';
import { Button } from '@/components/ui';
import { PreflightAircraft } from '../preflight-aircraft';
import { create, act } from '../../../../tests/support/renderer';

jest.mock('@/lib/use-reduced-motion', () => ({ useReducedMotion: () => false }));
jest.mock('@/components/ui', () => Object.fromEntries([
  'BusyRow', 'Button', 'Card', 'Notice', 'Screen', 'TopBar',
].map((name) => [name, ({ children }: { children?: React.ReactNode }) => children ?? null])));
let rendered: ReturnType<typeof create>;
afterEach(async () => { await act(async () => rendered?.unmount()); });
it.each(['loading', 'error'] as const)('offers an explicit no-aircraft choice while inventory is %s', async (state) => {
  const onSelect = jest.fn();
  const props = { inventory: undefined, selection: null, loading: state === 'loading', error: state === 'error',
    disabled: false, onSelect, onRetry: jest.fn() };
  await act(async () => { rendered = create(React.createElement(PreflightAircraft, props)); });
  const chooseNone = rendered.root.findAllByType(Button).find((node: any) => node.props.label === 'Record without aircraft details');
  expect(chooseNone.props.disabled).toBe(false);
  await act(async () => chooseNone.props.onPress());
  expect(onSelect).toHaveBeenCalledWith({ aircraftId: null });
  await act(async () => rendered.update(React.createElement(PreflightAircraft, { ...props, selection: { aircraftId: null } })));
  expect(rendered.root.findAllByProps({ children: 'No aircraft selected' }).length).toBeGreaterThan(0);
});
