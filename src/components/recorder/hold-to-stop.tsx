import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Alert,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useStableAnimatedValue } from '@/components/flight-ui';

import { fonts, night, paper } from '@/ui/theme';

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
    <View style={styles.wrap}>
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
        style={[styles.track, holding && styles.trackHolding, disabled && styles.disabled]}>
        <Animated.View style={[styles.fill, { width: fillWidth }]} />
        <View style={[styles.knob, holding && styles.knobHolding]}>
          <Text style={styles.knobGlyph}>■</Text>
        </View>
        <Text style={[styles.label, holding && styles.labelHolding]} numberOfLines={1}>
          {holding ? 'Keep holding to stop and save' : 'Hold to stop recording'}
        </Text>
        {!holding ? <Text style={styles.chevrons}>›››</Text> : null}
      </Pressable>
      <Text style={styles.hint} accessibilityElementsHidden>
        {holding ? 'Let go and it keeps recording.' : ' '}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  track: {
    height: 66,
    borderRadius: 33,
    backgroundColor: night.surface,
    borderWidth: 1,
    borderColor: night.border,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 6,
    overflow: 'hidden',
  },
  trackHolding: { borderColor: paper.thermal, backgroundColor: night.surfaceQuiet },
  disabled: { opacity: 0.4 },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(217,89,31,0.28)',
  },
  knob: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: paper.thermal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  knobHolding: { boxShadow: '0 0 22px rgba(217,89,31,0.6)' },
  knobGlyph: { fontFamily: fonts.monoSemi, fontSize: 15, color: paper.onDark },
  label: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fonts.sansSemi,
    fontSize: 13,
    letterSpacing: 0.2,
    color: night.muted,
    paddingRight: 28,
  },
  labelHolding: { color: '#C9803F' },
  chevrons: { position: 'absolute', right: 26, fontFamily: fonts.monoSemi, fontSize: 13, color: night.faint },
  hint: { textAlign: 'center', fontFamily: fonts.sans, fontSize: 10.5, color: night.dim, minHeight: 14 },
});
