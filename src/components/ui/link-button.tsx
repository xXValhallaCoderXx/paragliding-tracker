import { Pressable, Text } from 'react-native';

/** Text-only affordance in thermal, e.g. "Open Android settings ›". */
export function LinkButton({
  label,
  onPress,
  disabled = false,
  className = '',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => (disabled ? { opacity: 0.45 } : pressed ? { opacity: 0.72 } : null)}
      className={`min-h-[44px] justify-center ${className}`}>
      <Text className="font-body-medium text-[12.5px] text-thermal">{label}</Text>
    </Pressable>
  );
}
