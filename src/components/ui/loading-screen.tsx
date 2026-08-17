import { ActivityIndicator, Text } from 'react-native';

import { Screen } from '@/components/ui/screen';
import { paper } from '@/ui/theme';

export function LoadingScreen({ label }: { label: string }) {
  return (
    <Screen className="items-center justify-center gap-[12px]">
      <ActivityIndicator color={paper.thermal} size="large" />
      <Text className="font-body text-[13px] text-body">{label}</Text>
    </Screen>
  );
}
