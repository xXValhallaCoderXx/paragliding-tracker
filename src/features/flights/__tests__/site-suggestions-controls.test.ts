import React from 'react';
import { SiteSuggestions } from '../components/site-suggestions';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- resolve the renderer bundled with jest-expo
const { create, act } = require(require.resolve('react-test-renderer', { paths: [require.resolve('jest-expo/package.json')] }));
jest.mock('@reduxjs/toolkit/query', () => ({ skipToken: Symbol('skip') }));
jest.mock('@/components/ui', () => ({
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- use the native button under test without loading unrelated UI
  LinkButton: require('@/components/ui/link-button').LinkButton,
}));
jest.mock('@/store/endpoints', () => ({
  useSearchSitesQuery: () => ({ data: [] }),
  useNearbySitesQuery: () => ({ data: [{ id: 'launch-1', name: 'Ridge launch', provider: 'osm', distanceMetres: null, detail: null }] }),
}));

const near = { latitude: 46, longitude: 8 };
const onLocate = jest.fn();
const onOpen = jest.fn();
const props = { query: '', near: null, trigger: 'none', locating: false, disabled: false, onLocate, onOpen, onDismiss: jest.fn(), onSelect: jest.fn() } as const;
type ButtonNode = { type: unknown; props: { disabled: boolean; accessibilityRole: string; accessibilityState: { disabled: boolean }; onPress: () => void } };
let rendered: { root: { findAll: (predicate: (node: ButtonNode) => boolean) => ButtonNode[] }; unmount: () => void };
async function render(overrides: Partial<React.ComponentProps<typeof SiteSuggestions>>) {
  await act(async () => { rendered = create(React.createElement(SiteSuggestions, { ...props, ...overrides })); });
  return rendered.root.findAll((node) => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function' && typeof node.props.disabled === 'boolean');
}
beforeEach(() => jest.clearAllMocks());
afterEach(async () => { await act(async () => rendered.unmount()); });

it.each([
  { near: null, disabled: true },
  { near, disabled: true },
  { near: null, locating: true },
])('disables closed-panel actions while saving or locating: %o', async (overrides) => {
  const [button] = await render(overrides);
  expect(button!.props.disabled).toBe(true);
  expect(button!.props.accessibilityState).toEqual({ disabled: true });
});

it('disables both suggestion selection and closing while saving', async () => {
  const buttons = await render({ near, trigger: 'nearby', disabled: true });
  expect(buttons).toHaveLength(2);
  for (const button of buttons) {
    expect(button.props.disabled).toBe(true);
    expect(button.props.accessibilityState).toEqual({ disabled: true });
  }
});

it('keeps the location action available between saves', async () => {
  const [button] = await render({});
  expect(button!.props.disabled).toBe(false);
  button!.props.onPress();
  expect(onLocate).toHaveBeenCalledTimes(1);
});
