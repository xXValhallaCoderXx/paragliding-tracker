import { useRouter } from 'expo-router';
import { Text } from 'react-native';

import { Button, Screen, SectionLabel } from '@/components/ui';

export default function NotFoundScreen() {
  const router = useRouter();
  return (
    <Screen className="items-center justify-center gap-[12px] p-[28px]">
      <SectionLabel>Flight Log Alpha</SectionLabel>
      <Text className="text-center font-body-bold text-[22px] text-ink">
        That screen does not exist
      </Text>
      <Text className="text-center font-body text-[13.5px] leading-[21px] text-body">
        Nothing was lost — your flights are stored on this phone.
      </Text>
      <Button label="Back to logbook" variant="primary" onPress={() => router.replace('/')} />
    </Screen>
  );
}
