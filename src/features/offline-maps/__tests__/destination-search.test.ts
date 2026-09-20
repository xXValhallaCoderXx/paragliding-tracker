import React from 'react';
import { Button, Input, LinkButton } from '@/components/ui';
import { searchDestinations } from '@/offline-maps/destinations';
import type { DestinationSuggestion } from '@/offline-maps/types';
import { act, create } from '../../../../tests/support/renderer';
import { DestinationSearch } from '../destination-search';

jest.mock('@/offline-maps/destinations', () => ({
  ...jest.requireActual('@/offline-maps/destinations'), searchDestinations: jest.fn(),
}));
jest.mock('@/components/ui', () => ({
  Button: jest.fn(() => null), Input: jest.fn(() => null), LinkButton: jest.fn(() => null),
  SectionLabel: jest.fn(() => null), Notice: jest.fn(() => null),
  Card: ({ children }: { children: React.ReactNode }) => children,
}));

const destination: DestinationSuggestion = { id: 'bubus', name: 'Bukit Bubus', context: 'Terengganu, Malaysia',
  kind: 'terrain', center: [102.6, 5.7], provider: 'osm' };
type Rendered = { root: { findByType: (type: unknown) => { props: Record<string, any> }; findAllByType: (type: unknown) => { props: Record<string, any> }[] }; unmount: () => void };
let rendered: Rendered;
const select = jest.fn();
const input = () => rendered.root.findByType(Input).props;
const button = (label: string, type: unknown = Button) => rendered.root.findAllByType(type).find((node) => node.props.label === label)!.props;
beforeEach(async () => {
  jest.clearAllMocks(); jest.spyOn(Date, 'now').mockReturnValue(10_000);
  jest.mocked(searchDestinations).mockResolvedValue([]);
  await act(async () => { rendered = create(React.createElement(DestinationSearch, { onSelect: select })); });
});
afterEach(async () => { await act(async () => rendered.unmount()); jest.restoreAllMocks(); });

it('does not fetch on typing and accepts submitted two-letter destinations', async () => {
  await act(async () => input().onChangeText('UK'));
  expect(searchDestinations).not.toHaveBeenCalled();
  await act(async () => button('Search destinations').onPress());
  expect(searchDestinations).toHaveBeenCalledWith('UK', expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

it('cancels obsolete requests immediately and never displays their results', async () => {
  let finish!: (results: DestinationSuggestion[]) => void;
  jest.mocked(searchDestinations).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  await act(async () => input().onChangeText('Bubus'));
  await act(async () => button('Search destinations').onPress());
  const signal = jest.mocked(searchDestinations).mock.calls[0]![1]!.signal!;
  await act(async () => input().onChangeText('Wonogiri'));
  expect(signal.aborted).toBe(true);
  await act(async () => finish([destination]));
  expect(rendered.root.findAllByType(Button).some((node) => node.props.label === 'Preview Bukit Bubus')).toBe(false);
});

it('offers the Bubos spelling alternative explicitly without selecting a launch', async () => {
  await act(async () => input().onChangeText('Bukit Bubos'));
  await act(async () => button('Search destinations').onPress());
  expect(select).not.toHaveBeenCalled();
  jest.mocked(Date.now).mockReturnValue(12_000);
  await act(async () => button('Search Bukit Bubus, Terengganu instead', LinkButton).onPress());
  expect(searchDestinations).toHaveBeenLastCalledWith('Bukit Bubus, Terengganu', expect.any(Object));
  expect(select).not.toHaveBeenCalled();
});

it('leaves region selection to the user after successful search', async () => {
  jest.mocked(searchDestinations).mockResolvedValue([destination]);
  await act(async () => input().onChangeText('Bukit Bubus'));
  await act(async () => button('Search destinations').onPress());
  expect(select).not.toHaveBeenCalled();
  await act(async () => button('Preview Bukit Bubus').onPress());
  expect(select).toHaveBeenCalledWith(destination);
});
