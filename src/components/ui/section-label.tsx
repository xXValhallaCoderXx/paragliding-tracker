import type { ReactNode } from 'react';
import { Text } from 'react-native';

export function SectionLabel({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Text className={`font-data-medium text-[12px] tracking-[1.4px] text-muted ${className}`}>
      {typeof children === 'string' ? children.toUpperCase() : children}
    </Text>
  );
}
