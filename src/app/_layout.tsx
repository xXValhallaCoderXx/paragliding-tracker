// Tailwind entry. Deliberately imported here rather than in index.js: that file registers the
// background location task *before* expo-router, and that ordering is load-bearing. This is a
// module-scope side effect, so it is unaffected by the fonts gate on <Stack> below.
import '../global.css';

import Archivo_400Regular from '@expo-google-fonts/archivo/400Regular/Archivo_400Regular.ttf';
import Archivo_500Medium from '@expo-google-fonts/archivo/500Medium/Archivo_500Medium.ttf';
import Archivo_600SemiBold from '@expo-google-fonts/archivo/600SemiBold/Archivo_600SemiBold.ttf';
import Archivo_700Bold from '@expo-google-fonts/archivo/700Bold/Archivo_700Bold.ttf';
import IBMPlexMono_400Regular from '@expo-google-fonts/ibm-plex-mono/400Regular/IBMPlexMono_400Regular.ttf';
import IBMPlexMono_500Medium from '@expo-google-fonts/ibm-plex-mono/500Medium/IBMPlexMono_500Medium.ttf';
import IBMPlexMono_600SemiBold from '@expo-google-fonts/ibm-plex-mono/600SemiBold/IBMPlexMono_600SemiBold.ttf';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { RecorderLifecycleProvider } from '@/features/record/recorder-lifecycle';
import { paper } from '@/ui/theme';

// Keep the native splash up until the design fonts are ready (or fail), so the
// first frame never flashes fallback typography. Called at module scope as the
// SDK 57 docs recommend.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_600SemiBold,
    Archivo_700Bold,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
    IBMPlexMono_600SemiBold,
  });
  const fontsSettled = fontsLoaded || fontError !== null;

  useEffect(() => {
    if (fontsSettled) void SplashScreen.hideAsync().catch(() => undefined);
  }, [fontsSettled]);

  return (
    <RecorderLifecycleProvider>
      {fontsSettled ? (
        <Stack
          screenOptions={{
            animation: 'slide_from_right',
            contentStyle: { backgroundColor: paper.background },
            headerShown: false,
            // Every screen is warm paper, so the status bar is dark-on-light throughout.
            statusBarStyle: 'dark',
          }}
        />
      ) : null}
    </RecorderLifecycleProvider>
  );
}
