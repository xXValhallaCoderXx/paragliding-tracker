import { useState } from 'react';
import { Animated } from 'react-native';

/**
 * A stable Animated.Value created once per component instance. (React Native's
 * `useAnimatedValue` is not exported by react-native-web, and reading a ref during render is
 * disallowed by the React Compiler rules this project lints with.)
 */
export function useStableAnimatedValue(initialValue: number): Animated.Value {
  const [value] = useState(() => new Animated.Value(initialValue));
  return value;
}
