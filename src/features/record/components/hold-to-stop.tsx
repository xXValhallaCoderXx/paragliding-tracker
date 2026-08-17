import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, Animated, Easing, Pressable, Text, View } from 'react-native';

import { useStableAnimatedValue } from '@/lib/use-stable-animated-value';

export const HOLD_TO_STOP_MS = 1_400;

/**
 * Deliberate stop control: press and hold until the fill completes. Letting go
 * early cancels, so a brush of the screen in flight cannot end the recording.
 * With a screen reader running, a long press asks for confirmation instead.
 */
export function HoldToStop({
  onConfirm,
  disabled = false,
  holdMs = HOLD_TO_STOP_MS,
}: {
  onConfirm: () => void;
  disabled?: boolean;
  holdMs?: number;
}) {
  const progress = useStableAnimatedValue(0);
  const animation = useRef<Animated.CompositeAnimation | null>(null);
  const [holding, setHolding] = useState(false);
  const [screenReader, setScreenReader] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isScreenReaderEnabled()
      .then((enabled) => {
        if (mounted) setScreenReader(enabled);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', (enabled) => {
      if (mounted) setScreenReader(enabled);
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(
    () => () => {
      animation.current?.stop();
    },
    [],
  );

  const reset = (animated: boolean) => {
    animation.current?.stop();
    animation.current = null;
    setHolding(false);
    if (animated) {
      Animated.timing(progress, {
        toValue: 0,
        duration: 160,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }).start();
    } else {
      progress.setValue(0);
    }
  };

  const beginHold = () => {
    if (disabled || screenReader) return;
    setHolding(true);
    progress.setValue(0);
    const timing = Animated.timing(progress, {
      toValue: 1,
      duration: holdMs,
      easing: Easing.linear,
      useNativeDriver: false,
    });
    animation.current = timing;
    timing.start(({ finished }) => {
      if (!finished) return;
      animation.current = null;
      setHolding(false);
      progress.setValue(0);
      onConfirm();
    });
  };

  const confirmWithDialog = () => {
    Alert.alert('Stop recording?', 'Use this after you have landed. The flight is saved on this phone.', [
      { text: 'Keep recording', style: 'cancel' },
      { text: 'Stop and save', style: 'destructive', onPress: onConfirm },
    ]);
  };

  const fillWidth = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View className="gap-[10px]">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Stop recording"
        accessibilityHint={
          screenReader
            ? 'Double-tap and hold, then confirm to stop and save the flight.'
            : 'Press and hold for one and a half seconds to stop and save the flight.'
        }
        accessibilityState={{ disabled }}
        disabled={disabled}
        delayLongPress={600}
        onPressIn={beginHold}
        onPressOut={() => {
          if (animation.current) reset(true);
        }}
        onLongPress={() => {
          if (screenReader) confirmWithDialog();
        }}
        className={`h-[66px] flex-row items-center overflow-hidden rounded-[33px] border p-[6px] ${
          holding ? 'border-thermal bg-thermal-soft' : 'border-border bg-card'
        } ${disabled ? 'opacity-40' : ''}`}>
        {/* Animated.View takes no className — the width is a driven interpolation. */}
        <Animated.View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: fillWidth,
            backgroundColor: 'rgba(217,89,31,0.28)',
          }}
        />
        <View
          className={`h-[54px] w-[54px] items-center justify-center rounded-[27px] bg-thermal ${
            // A soft halo ring rather than the old glow: the original
            // `0 0 22px rgba(217,89,31,0.6)` was designed to bloom against near-black and
            // turns muddy on cream.
            holding ? 'shadow-[0_0_0_6px_rgba(217,89,31,0.18)]' : ''
          }`}>
          <Text className="font-data-semi text-[15px] text-on-dark">■</Text>
        </View>
        <Text
          className={`flex-1 pr-[28px] text-center font-body-semi text-[13px] tracking-[0.2px] ${
            holding ? 'text-thermal-ink' : 'text-muted'
          }`}
          numberOfLines={1}>
          {holding ? 'Keep holding to stop and save' : 'Hold to stop recording'}
        </Text>
        {!holding ? (
          <Text className="absolute right-[26px] font-data-semi text-[13px] text-faint">›››</Text>
        ) : null}
      </Pressable>
      <Text
        className="min-h-[14px] text-center font-body text-[10.5px] text-muted"
        accessibilityElementsHidden>
        {holding ? 'Let go and it keeps recording.' : ' '}
      </Text>
    </View>
  );
}
