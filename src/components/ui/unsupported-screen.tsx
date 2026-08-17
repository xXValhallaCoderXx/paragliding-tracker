import { Text } from 'react-native';

import { Screen } from '@/components/ui/screen';
import { SectionLabel } from '@/components/ui/section-label';

export function UnsupportedScreen() {
  return (
    <Screen className="items-center justify-center gap-[12px] p-[28px]">
      <SectionLabel>Flight Log Alpha</SectionLabel>
      <Text className="text-center font-body-bold text-[26px] text-ink">
        Open this on your phone
      </Text>
      <Text className="max-w-[520px] text-center font-body text-[14px] leading-[21px] text-body">
        Flight recording and your local logbook live in the installed Android build. The web
        version only checks that the project builds cleanly.
      </Text>
    </Screen>
  );
}
