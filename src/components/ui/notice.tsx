import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

type NoticeTone = 'info' | 'warning' | 'danger' | 'good';

const NOTICE: Record<NoticeTone, { box: string; title: string; body: string }> = {
  info: { box: 'bg-card-alt border-border', title: 'text-ink', body: 'text-body' },
  good: { box: 'bg-good-soft border-good-border', title: 'text-good', body: 'text-good-body' },
  warning: { box: 'bg-warn-soft border-warn-border', title: 'text-warn-ink', body: 'text-warn-body' },
  danger: {
    box: 'bg-danger-soft border-danger-border',
    title: 'text-danger',
    body: 'text-danger-body',
  },
};

export function Notice({
  title,
  children,
  tone = 'info',
}: {
  title?: string;
  children?: ReactNode;
  tone?: NoticeTone;
}) {
  const palette = NOTICE[tone];
  return (
    <View
      accessibilityRole={tone === 'danger' ? 'alert' : undefined}
      className={`gap-[2px] rounded-[11px] border px-[13px] py-[11px] ${palette.box}`}>
      {title ? (
        <Text className={`font-body-semi text-[11.5px] ${palette.title}`}>{title}</Text>
      ) : null}
      {children ? (
        <Text
          className={`font-body ${
            title ? 'text-[11.5px] leading-[16px]' : 'text-[12.5px] leading-[18px]'
          } ${palette.body}`}>
          {children}
        </Text>
      ) : null}
    </View>
  );
}
