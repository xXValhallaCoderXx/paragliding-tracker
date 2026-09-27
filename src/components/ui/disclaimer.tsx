import type { ReactNode } from 'react';
import { Text } from 'react-native';

export function Disclaimer({
  children,
  align = 'center',
  className = '',
}: {
  children: ReactNode;
  align?: 'center' | 'left';
  className?: string;
}) {
  return (
    <Text
      className={`font-body text-[12px] leading-[19px] text-muted ${
        align === 'left' ? 'text-left' : 'text-center'
      } ${className}`}>
      {children}
    </Text>
  );
}
