import { Pressable, Text } from 'react-native';

/** Text-only affordance in thermal, e.g. "Open Android settings ›". */
export function LinkButton({
  label,
  onPress,
  className = '',
}: {
  label: string;
  onPress: () => void;
  className?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => (pressed ? { opacity: 0.72 } : null)}
      className={`min-h-[40px] justify-center ${className}`}>
      <Text className="font-body-medium text-[12.5px] text-thermal">{label}</Text>
    </Pressable>
  );
}
