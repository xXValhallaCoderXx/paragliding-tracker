import { Text, View } from 'react-native';

export type ChipTone = 'good' | 'altitude' | 'muted' | 'warning' | 'danger' | 'thermal';

const CHIP: Record<ChipTone, { box: string; text: string }> = {
  good: { box: 'bg-good-soft', text: 'text-good' },
  altitude: { box: 'bg-altitude-soft', text: 'text-altitude' },
  muted: { box: 'bg-card-alt', text: 'text-muted' },
  warning: { box: 'bg-warn-soft border border-warn-border', text: 'text-warn-ink' },
  danger: { box: 'bg-danger-soft border border-danger-border', text: 'text-danger' },
  thermal: { box: 'bg-thermal-soft', text: 'text-thermal-ink' },
};

export function Chip({ label, tone = 'muted' }: { label: string; tone?: ChipTone }) {
  return (
    <View className={`self-start rounded-[5px] px-[6px] py-[3px] ${CHIP[tone].box}`}>
      <Text className={`font-data-medium text-[9.5px] tracking-[0.3px] ${CHIP[tone].text}`}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}
