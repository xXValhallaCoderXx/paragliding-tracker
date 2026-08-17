import { Tabs } from 'expo-router';

import { paper } from '@/ui/theme';

/**
 * Tab shell. Only the logbook exists today, so the bar is hidden — a single-tab bar is noise.
 * Adding Stats or Settings later is one file per tab plus deleting the `tabBarStyle` line.
 *
 * `/record` and `/flights/[id]` deliberately sit *above* this group in the root Stack, so they
 * present full-screen over the tabs. Route groups do not appear in the URL, so every existing
 * `router.push('/')` and `router.replace('/')` still resolves here unchanged.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { display: 'none' },
        sceneStyle: { backgroundColor: paper.background },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Logbook' }} />
    </Tabs>
  );
}
