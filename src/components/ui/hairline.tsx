import { View } from 'react-native';

export function Hairline({ className = '' }: { className?: string }) {
  return <View className={`h-px bg-hairline ${className}`} />;
}
