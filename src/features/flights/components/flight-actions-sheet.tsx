import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { paper, radii } from '@/ui/theme';

export interface FlightAction { label: string; reason?: string | null; onPress: () => void; danger?: boolean }
export function FlightActionsSheet({ actions, onClose }: { actions: FlightAction[]; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  return <Modal visible transparent animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={onClose}>
    <View style={{ flex: 1, justifyContent: 'flex-end', paddingTop: insets.top + 20 }}>
      <Pressable accessibilityLabel="Close flight actions" accessibilityRole="button" onPress={onClose}
        style={[StyleSheet.absoluteFill, { backgroundColor: paper.ink, opacity: 0.25 }]} />
      <View accessibilityViewIsModal style={{ maxHeight: '100%', backgroundColor: paper.sheet, borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet, paddingBottom: insets.bottom }}>
        <ScrollView contentContainerStyle={{ padding: 18, gap: 12 }}>
          <Text accessibilityRole="header" className="font-body-bold text-[26px] text-ink">Flight actions</Text>
          {actions.map(action => <View key={action.label} className="gap-[4px]">
            <Button label={action.label} variant={action.danger ? 'danger' : 'secondary'} disabled={Boolean(action.reason)} onPress={action.onPress} />
            {action.reason ? <Text className="font-body text-[12px] text-muted">{action.reason}</Text> : null}
          </View>)}
          <Button label="Cancel" onPress={onClose} />
        </ScrollView>
      </View>
    </View>
  </Modal>;
}
