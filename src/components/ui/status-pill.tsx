import { Text, View } from 'react-native';

import { PulseDot } from '@/components/ui/pulse-dot';
import { paper, type Tone } from '@/ui/theme';

/**
 * Rounded pill for the recorder header ("REC", "GPS STALE", "PHONE SENSORS · 62%").
 *
 * This was previously night-only — every colour came from the instrument palette, so it was
 * unreadable on paper. Repainted onto the same soft/border pairs Chip and Notice already use,
 * so the recorder header now speaks the same visual language as the rest of the app.
 * `emphasis` is the live-REC badge and is the only thermal-toned state.
 */
const PILL: Record<Tone, { box: string; text: string; dot: string }> = {
  neutral: { box: 'bg-card border-border', text: 'text-muted', dot: paper.faint },
  good: { box: 'bg-good-soft border-good-border', text: 'text-good', dot: paper.good },
  warning: { box: 'bg-warn-soft border-warn-border', text: 'text-warn-ink', dot: paper.warn },
  danger: { box: 'bg-danger-soft border-danger-border', text: 'text-danger', dot: paper.danger },
};

const EMPHASIS = {
  box: 'bg-thermal-soft border-thermal px-[13px] gap-[9px]',
  text: 'text-thermal-ink',
  dot: paper.thermal,
};

export function StatusPill({
  label,
  tone = 'neutral',
  pulse = false,
  emphasis = false,
}: {
  label: string;
  tone?: Tone;
  pulse?: boolean;
  emphasis?: boolean;
}) {
  const palette = emphasis ? EMPHASIS : PILL[tone];
  return (
    <View
      className={`flex-row items-center gap-[8px] rounded-[20px] border px-[12px] py-[7px] ${palette.box}`}>
      <PulseDot color={palette.dot} size={emphasis ? 9 : 7} pulse={pulse} />
      <Text className={`font-data-semi text-[10.5px] tracking-[1.1px] ${palette.text}`}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}
