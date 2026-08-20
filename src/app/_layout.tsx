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
import { Provider } from 'react-redux';

import { CloudAuthProvider } from '@/features/account/auth-provider';
import { CloudSyncProvider } from '@/features/account/cloud-sync-provider';
import { FirstRunProvider } from '@/features/onboarding/first-run-provider';
import { FirstRunGate } from '@/features/onboarding/components/first-run-gate';
import { RecorderLifecycleProvider } from '@/features/record/recorder-lifecycle';
import { store } from '@/store';
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

  // Auth sits outermost because it depends on nothing and restoring a stored session is
  // fast. Sync sits inside the recorder lifecycle so it can see `recovering` and stay out
  // of the way. All three stay outside the fonts gate, so session restore and recorder
  // recovery run in parallel with font loading.
  //
  // None of them gates a route: signing in is optional, and the recorder must work with
  // no account and no signal. There is deliberately no Stack.Protected in this app.
  //
  // <Provider> is outermost and, for now, purely additive — the store holds only the RTK
  // Query cache and nothing reads it yet. The four providers migrate into it one at a
  // time so each step can be verified on a device before the next.
  //
  // First-run setup is the same story. FirstRunGate draws it as a full-screen overlay
  // *above* the navigator rather than in place of it, so the router is always mounted:
  // deep links stay routed, the back handler has something to consume, and finishing
  // setup is a plain unmount with no navigation churn. The splash is deliberately not
  // gated on it — that read sits behind the database migration, which can take seconds
  // and can fail, and a splash that never lifts is a bricked app.
  return (
    <Provider store={store}>
      <CloudAuthProvider>
        <RecorderLifecycleProvider>
          <CloudSyncProvider>
            <FirstRunProvider>
              {fontsSettled ? (
                <FirstRunGate>
                  <Stack
                    screenOptions={{
                      animation: 'slide_from_right',
                      contentStyle: { backgroundColor: paper.background },
                      headerShown: false,
                      // Every screen is warm paper, so the status bar is dark-on-light throughout.
                      statusBarStyle: 'dark',
                    }}
                  />
                </FirstRunGate>
              ) : null}
            </FirstRunProvider>
          </CloudSyncProvider>
        </RecorderLifecycleProvider>
      </CloudAuthProvider>
    </Provider>
  );
}
