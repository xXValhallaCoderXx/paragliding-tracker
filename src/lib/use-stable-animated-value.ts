import { useState } from 'react';
import { Animated } from 'react-native';

/**
 * A stable Animated.Value created once per component instance. The lazy state initializer
 * avoids reading a ref during render, which the React Compiler rules reject.
 */
export function useStableAnimatedValue(initialValue: number): Animated.Value {
  const [value] = useState(() => new Animated.Value(initialValue));
  return value;
}
