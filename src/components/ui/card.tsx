import type { ReactNode } from 'react';
import { View } from 'react-native';

/**
 * `variant="dark"` is the inverted stats block used on the interrupted-flight and season
 * surfaces. It is a paper-family token (`paper.ink`), not part of any dark theme.
 */
export function Card({
  children,
  variant = 'default',
  className = '',
}: {
  children: ReactNode;
  variant?: 'default' | 'dark';
  className?: string;
}) {
  const surface = variant === 'dark' ? 'bg-ink border-ink' : 'bg-card border-border';
  return <View className={`rounded-card border ${surface} ${className}`}>{children}</View>;
}
