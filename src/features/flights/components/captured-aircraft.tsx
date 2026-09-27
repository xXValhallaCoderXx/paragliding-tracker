import { Text, View } from 'react-native';
import { SectionLabel } from '@/components/ui';
import type { FlightSummary } from '@/recorder/types';

export function CapturedAircraft({ flight }: { flight: FlightSummary }) {
  const snapshot = flight.equipmentSnapshot;
  const sport = snapshot?.sport ? { paragliding: 'Paragliding', hang_gliding: 'Hang gliding', speedflying: 'Speedflying' }[snapshot.sport] : '—';
  return <View className="gap-[8px]">
    <SectionLabel>Aircraft at Start</SectionLabel>
    {!snapshot ? <Text className="font-body text-[15px] text-ink">Unknown aircraft · no equipment was captured with this older flight.</Text>
      : !snapshot.aircraftId ? <Text className="font-body text-[15px] text-ink">No aircraft selected for this recording.</Text>
      : <>
        <Text className="font-body-bold text-[21px] text-ink">{snapshot.model || '—'}</Text>
        <Text className="font-body text-[15px] text-ink">{sport} · Size {snapshot.size || '—'}</Text>
        <Text className="font-body text-[14px] text-muted">Aircraft registration: {snapshot.registrationId || '—'}</Text>
      </>}
    <Text className="font-body text-[12px] text-muted">Captured with this flight. Changes in Pilot do not change this record.</Text>
  </View>;
}
