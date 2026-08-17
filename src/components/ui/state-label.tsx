import { Text, View } from 'react-native';

import { PulseDot } from '@/components/ui/pulse-dot';
import { toneColor } from '@/components/ui/tone';
import { paper, type Tone } from '@/ui/theme';

/**
 * Small state label with a dot, e.g. "● ALL GOOD" on the pre-flight screen. The dot only pulses
 * when explicitly asked to, so degraded states can never borrow the "live" cue.
 */
export function StateLabel({
  label,
  tone,
  pulse = false,
  halo = true,
}: {
  label: string;
  tone: Tone;
  pulse?: boolean;
  halo?: boolean;
}) {
  const color = toneColor(tone);
  return (
    <View className="flex-row items-center gap-[11px]">
      <PulseDot color={color} size={12} pulse={pulse} halo={halo} />
      {/* Neutral reads as body copy rather than the faint dot colour, which would be unreadable. */}
      <Text
        className="font-data-semi text-[10px] tracking-[1.2px]"
        style={{ color: tone === 'neutral' ? paper.text : color }}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}
