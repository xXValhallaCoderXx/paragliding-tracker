import React from 'react';
import { Text } from 'react-native';
import { Button } from '@/components/ui';
import type { ArchivedFlightDetail } from '@/recorder/types';
import { flight } from '../../../../tests/support/fixtures';
import { create, act } from '../../../../tests/support/renderer';
import { EvidenceBlock } from '../components/evidence';

it('renders archive provenance with no session and never offers original diagnostics', async () => {
  const archived: ArchivedFlightDetail = { ...flight(), source: 'archive', ownerUserId: 'pilot',
    sessionStatus: null, session: null, archive: { trackState: 'pending', error: null, downloadedAt: null } };
  let rendered: { root: { findAllByType: (type: unknown) => { props: { children: string } }[] }; unmount: () => void };
  await act(async () => { rendered = create(React.createElement(EvidenceBlock, {
    flight: archived, open: true, onToggle: jest.fn(), onExportDiagnostics: jest.fn(), exportDisabled: true,
  })); });
  expect(rendered!.root.findAllByType(Button)).toHaveLength(0);
  const copy = rendered!.root.findAllByType(Text).map((node) => node.props.children).join(' ');
  expect(copy).toContain('Restored from your account');
  expect(copy).toContain('were not backed up');
  await act(async () => rendered!.unmount());
});
