import { Text, View } from 'react-native';

import { LinkButton } from '@/components/ui/link-button';
import { toneColor } from '@/components/ui/tone';
import type { Tone } from '@/ui/theme';

/** Private to the row — the only place a bare tone dot is used. */
function ToneDot({ tone, size = 7 }: { tone: Tone; size?: number }) {
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: toneColor(tone) }}
    />
  );
}

const VALUE_TONE: Partial<Record<Tone, string>> = {
  danger: 'text-danger',
  warning: 'text-warn-ink',
};

/** A label/value row inside a paper card, in the pre-flight checklist style. */
export function ListRow({
  label,
  value,
  tone = 'neutral',
  showDot = false,
  detail,
  action,
  last = false,
  mono = true,
}: {
  label: string;
  value?: string;
  tone?: Tone;
  showDot?: boolean;
  detail?: string | null;
  action?: { label: string; onPress: () => void } | null;
  last?: boolean;
  mono?: boolean;
}) {
  return (
    <View
      className={`gap-[4px] py-[13px] ${last ? '' : 'border-b border-b-hairline'}`}>
      <View className="flex-row flex-wrap items-center justify-between gap-[10px]">
        <Text className="shrink font-body-medium text-[13px] text-ink">{label}</Text>
        {value !== undefined ? (
          <View className="shrink flex-row items-center gap-[8px]">
            <Text
              className={`text-right ${
                mono ? 'font-data-medium text-[11.5px] text-body' : 'font-body-semi text-[13px] text-ink'
              } ${VALUE_TONE[tone] ?? ''}`}>
              {value}
            </Text>
            {showDot ? <ToneDot tone={tone} /> : null}
          </View>
        ) : null}
      </View>
      {detail ? (
        <Text className="font-body text-[11.5px] leading-[16.5px] text-body">{detail}</Text>
      ) : null}
      {action ? (
        <LinkButton
          label={`${action.label} ›`}
          onPress={action.onPress}
          className="mt-[2px] min-h-[44px]"
        />
      ) : null}
    </View>
  );
}
