import React from 'react';
import { styled } from 'nativewind';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Screen } from '@/components/ui/screen';
import { act, create } from '../../../tests/support/renderer';

jest.mock('nativewind', () => ({ styled: jest.fn(() => 'StyledSafeArea') }));
it('registers the safe area wrapper and forwards flex, background and caller classes', async () => {
  let rendered: ReturnType<typeof create>;
  await act(async () => {
    // Required children prop in the component's type is not inferred from createElement's rest arguments.
    // eslint-disable-next-line react/no-children-prop
    rendered = create(React.createElement(Screen, { className: 'px-4', children: 'Flight' }));
  });
  try {
    expect(styled).toHaveBeenCalledWith(SafeAreaView);
    const safeArea = rendered.root.findByType('StyledSafeArea');
    expect(safeArea.props.className.split(/\s+/)).toEqual(expect.arrayContaining(['flex-1', 'bg-background', 'px-4']));
    expect(safeArea.props.children).toBe('Flight');
  } finally { await act(async () => rendered.unmount()); }
});
