import { useEffect } from 'react';
import { Animated, Easing } from 'react-native';

import { useStableAnimatedValue } from '@/lib/use-stable-animated-value';

/**
 * Animated.View is not one of the components react-native-css wraps, so it takes no
 * `className` — this stays on inline styles, which suits it anyway: size, colour and the halo
 * are all runtime values.
 */
export function PulseDot({
  color,
  size = 9,
  pulse,
  halo = false,
}: {
  color: string;
  size?: number;
  pulse: boolean;
  halo?: boolean;
}) {
  const opacity = useStableAnimatedValue(1);
  useEffect(() => {
    if (!pulse) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.25,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, pulse]);

  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity,
        ...(halo ? { boxShadow: `0 0 0 5px ${color}29` } : null),
      }}
    />
  );
}
