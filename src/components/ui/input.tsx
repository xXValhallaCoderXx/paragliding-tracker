import { Text, TextInput, View, type KeyboardTypeOptions, type TextInputProps } from 'react-native';

import { paper } from '@/ui/theme';

/**
 * A labelled text field.
 *
 * Promoted from the file-private `Field` in the flight metadata form so the sign-in
 * and pilot profile forms share one set of input conventions. Styled with `className`
 * rather than StyleSheet to match the rest of the kit — `TextInput` is in
 * react-native-css's wrapped set, so the prop is honoured.
 *
 * Colour props (`placeholderTextColor`, `selectionColor`, `cursorColor`) stay as JS
 * props: they are not styles and have no utility equivalent.
 */
export function Input({
  label,
  value,
  placeholder,
  onChangeText,
  maxLength,
  multiline = false,
  editable = true,
  last = false,
  autoCapitalize = 'sentences',
  autoComplete,
  autoFocus = false,
  keyboardType,
  textContentType,
  hint,
  error,
  onSubmitEditing,
  onFocus,
  returnKeyType,
  className = '',
}: {
  label: string;
  value: string;
  placeholder: string;
  onChangeText: (value: string) => void;
  maxLength: number;
  multiline?: boolean;
  editable?: boolean;
  /** Drops the bottom hairline for the final field in a stack. */
  last?: boolean;
  autoCapitalize?: TextInputProps['autoCapitalize'];
  autoComplete?: TextInputProps['autoComplete'];
  autoFocus?: boolean;
  keyboardType?: KeyboardTypeOptions;
  textContentType?: TextInputProps['textContentType'];
  /** Helper line under the field, e.g. a resend countdown. */
  hint?: string | null;
  /** Replaces the hint and recolours it. Announced to screen readers. */
  error?: string | null;
  onSubmitEditing?: () => void;
  /** Fires when the field takes focus. Deliberately no `onBlur`: a suggestion list below a
   * field blurs it before the row's press lands, so closing on blur eats the tap. */
  onFocus?: () => void;
  returnKeyType?: TextInputProps['returnKeyType'];
  className?: string;
}) {
  return (
    <View className={`gap-[4px] py-[11px] ${last ? '' : 'border-b border-b-hairline'} ${className}`}>
      <Text className="font-body-semi text-[9.5px] tracking-[1.4px] text-muted">
        {label.toUpperCase()}
      </Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        className={
          multiline
            ? 'min-h-[72px] px-0 py-[4px] font-body text-[14px] leading-[20px] text-ink'
            : 'min-h-[30px] px-0 py-[4px] font-body-semi text-[15px] text-ink'
        }
        cursorColor={paper.thermal}
        editable={editable}
        keyboardType={keyboardType}
        maxLength={maxLength}
        multiline={multiline}
        onChangeText={onChangeText}
        onFocus={onFocus}
        onSubmitEditing={onSubmitEditing}
        placeholder={placeholder}
        placeholderTextColor={paper.placeholder}
        returnKeyType={returnKeyType}
        selectionColor={paper.thermal}
        textAlignVertical={multiline ? 'top' : 'center'}
        textContentType={textContentType}
        value={value}
      />
      {error ? (
        <Text accessibilityRole="alert" className="font-body text-[11.5px] text-danger-body">
          {error}
        </Text>
      ) : hint ? (
        <Text className="font-body text-[11.5px] text-muted">{hint}</Text>
      ) : null}
    </View>
  );
}
