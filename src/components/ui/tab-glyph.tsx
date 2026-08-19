import { View, type ColorValue } from 'react-native';

export type TabGlyphShape = 'logbook' | 'pilot';

/**
 * Tab bar icons, drawn from primitives.
 *
 * No icon package is installed, and `expo-symbols` is iOS-only, so these are small View
 * compositions. They take a runtime `color` from the navigator rather than a
 * `className`, which is also why they need no entry in the kit's className allowlist.
 */
export function TabGlyph({
  shape,
  color,
  focused,
}: {
  shape: TabGlyphShape;
  /** Comes straight from the navigator's active/inactive tint. */
  color: ColorValue;
  focused: boolean;
}) {
  const width = focused ? 2 : 1.5;
  if (shape === 'pilot') {
    return (
      <View style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
        <View
          style={{
            width: 7.5,
            height: 7.5,
            borderRadius: 999,
            borderWidth: width,
            borderColor: color,
          }}
        />
        <View
          style={{
            marginTop: 2,
            width: 15,
            height: 8,
            borderTopLeftRadius: 999,
            borderTopRightRadius: 999,
            borderWidth: width,
            borderBottomWidth: 0,
            borderColor: color,
          }}
        />
      </View>
    );
  }
  return (
    <View style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: 16,
          height: 17,
          borderRadius: 3,
          borderWidth: width,
          borderColor: color,
        }}
      />
      {/* The spine, which is what makes it read as a logbook rather than a plain card. */}
      <View
        style={{
          position: 'absolute',
          left: 5.5,
          top: 1.5,
          width: width,
          height: 17,
          backgroundColor: color,
        }}
      />
    </View>
  );
}
