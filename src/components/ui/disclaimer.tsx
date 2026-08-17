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
      className={`font-body text-[10.5px] leading-[15px] text-muted ${
        align === 'left' ? 'text-left' : 'text-center'
      } ${className}`}>
      {children}
    </Text>
  );
}
