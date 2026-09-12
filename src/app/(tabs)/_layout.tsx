import { Tabs } from 'expo-router';

import { TabGlyph } from '@/components/ui';
import { fonts, paper } from '@/ui/theme';

/**
 * Tab shell: the logbook and the pilot's account.
 *
 * `/record` and `/flights/[id]` deliberately sit *above* this group in the root Stack, so they
 * present full-screen over the tabs. Route groups do not appear in the URL, so every existing
 * `router.push('/')` and `router.replace('/')` still resolves to the logbook unchanged.
 *
 * Account is intentionally a peer of the logbook rather than a gate in front of it: signing in
 * is optional, and the recorder has to work with no account and no signal.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: paper.background },
        tabBarActiveTintColor: paper.thermal,
        tabBarInactiveTintColor: paper.muted,
        // The navigator reserves the bar and its bottom safe area below each tab scene.
        // Tab screens only need top/side safe areas and padding for their own controls.
        tabBarStyle: {
          backgroundColor: paper.card,
          borderTopColor: paper.border,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: { fontFamily: fonts.sansSemi, fontSize: 10, letterSpacing: 0.6 },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Logbook',
          tabBarIcon: ({ color, focused }) => (
            <TabGlyph shape="logbook" color={color} focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Account',
          tabBarIcon: ({ color, focused }) => (
            <TabGlyph shape="pilot" color={color} focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}
