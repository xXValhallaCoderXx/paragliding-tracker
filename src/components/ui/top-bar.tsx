import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

export function TopBar({
  onBack,
  backLabel = 'Back',
  title,
  right,
}: {
  onBack?: () => void;
  backLabel?: string;
  title?: string;
  right?: ReactNode;
}) {
  return (
    <View className="min-h-[50px] flex-row items-center justify-between px-[12px] pt-[6px]">
      <View className="flex-1 flex-row items-center gap-[6px]">
        {onBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={backLabel}
            hitSlop={10}
            onPress={onBack}
            style={({ pressed }) => (pressed ? { opacity: 0.72 } : null)}
            className="h-[44px] w-[44px] items-center justify-center rounded-[19px] border border-border bg-card">
            <Text className="mt-[-2px] font-body-semi text-[21px] leading-[24px] text-ink">‹</Text>
          </Pressable>
        ) : null}
        {title ? (
          <Text className="shrink font-body-semi text-[13px] text-body" numberOfLines={1}>
            {title}
          </Text>
        ) : null}
      </View>
      {right ? <View className="flex-row items-center gap-[8px]">{right}</View> : null}
    </View>
  );
}
