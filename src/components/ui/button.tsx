import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { paper } from '@/ui/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'dark' | 'danger';

const SURFACE: Record<ButtonVariant, string> = {
  primary: 'bg-thermal border-thermal',
  secondary: 'bg-card border-border',
  ghost: 'bg-transparent',
  dark: 'bg-ink border-ink',
  danger: 'bg-card border-danger-border',
};

const LABEL: Record<ButtonVariant, string> = {
  primary: 'text-on-dark',
  secondary: 'text-ink',
  ghost: 'text-muted',
  dark: 'text-on-dark',
  danger: 'text-danger',
};

/** ActivityIndicator takes a colour prop, not a class, so the tint is resolved in JS. */
const SPINNER: Record<ButtonVariant, string> = {
  primary: paper.onDark,
  secondary: paper.ink,
  ghost: paper.muted,
  dark: paper.onDark,
  danger: paper.danger,
};

const SIZE = {
  md: { box: 'min-h-[46px] rounded-[11px] gap-[8px]', text: 'text-[13.5px]' },
  lg: { box: 'min-h-[56px] rounded-card gap-[10px]', text: 'text-[15.5px]' },
  xl: { box: 'min-h-[60px] rounded-control-large gap-[11px]', text: 'text-[17px]' },
} as const;

export function Button({
  label,
  onPress,
  variant = 'secondary',
  size = 'md',
  disabled = false,
  busy = false,
  leadingDot = false,
  className = '',
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: 'md' | 'lg' | 'xl';
  disabled?: boolean;
  busy?: boolean;
  leadingDot?: boolean;
  className?: string;
  accessibilityHint?: string;
}) {
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      // The pressed state comes from Pressable's render-prop, which className cannot express.
      style={({ pressed }) => (pressed && !inactive ? { opacity: 0.72 } : null)}
      className={`flex-row items-center justify-center border border-transparent px-[16px] py-[10px] ${
        SIZE[size].box
      } ${SURFACE[variant]} ${
        variant === 'primary' && size === 'xl' ? 'shadow-[0_6px_18px_rgba(217,89,31,0.34)]' : ''
      } ${inactive ? 'opacity-[0.42]' : ''} ${className}`}>
      {busy ? (
        <ActivityIndicator color={SPINNER[variant]} size="small" />
      ) : leadingDot ? (
        <View
          className={`rounded-[7px] bg-on-dark ${
            size === 'xl' ? 'h-[13px] w-[13px]' : 'h-[12px] w-[12px]'
          }`}
        />
      ) : null}
      <Text className={`shrink text-center font-body-semi ${SIZE[size].text} ${LABEL[variant]}`}>
        {label}
      </Text>
    </Pressable>
  );
}
