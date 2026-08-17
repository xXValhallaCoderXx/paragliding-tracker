import { ActivityIndicator, Text, View } from 'react-native';

import { paper } from '@/ui/theme';

export function BusyRow({ label }: { label: string }) {
  return (
    <View
      className="min-h-[32px] flex-row items-center justify-center gap-[8px]"
      accessibilityLiveRegion="polite">
      <ActivityIndicator color={paper.thermal} />
      <Text className="font-body text-[13px] text-body">{label}</Text>
    </View>
  );
}
