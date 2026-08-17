import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { RecorderLifecycleProvider } from '@/components/recorder-lifecycle';

export default function RootLayout() {
  return (
    <RecorderLifecycleProvider>
      <Stack
        screenOptions={{
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: '#07111f' },
          headerShown: false,
        }}
      />
      <StatusBar style="light" />
    </RecorderLifecycleProvider>
  );
}
