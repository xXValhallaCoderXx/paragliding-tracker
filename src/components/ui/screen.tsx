import { styled } from 'nativewind';
import type { ReactNode } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * react-native-css only wraps a fixed set of React Native primitives (View, Text, Pressable,
 * ScrollView, …) plus `SafeAreaProvider`. `SafeAreaView` is re-exported verbatim from
 * react-native-safe-area-context, so it does NOT understand `className` — passing one is
 * silently ignored, which cost this screen its `flex: 1` and collapsed every route to zero
 * height on device. `styled()` registers it explicitly, and the safe-area wrapper test keeps
 * that regression from returning.
 */
const SafeArea = styled(SafeAreaView);

export function Screen({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <SafeArea className={`flex-1 bg-background ${className}`}>{children}</SafeArea>;
}
