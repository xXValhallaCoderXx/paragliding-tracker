import { Text, View } from 'react-native';
import { Button, Notice } from '@/components/ui';
import type { useFlightDraft } from '../use-flight-draft';
import { siteAttribution } from '../site-picker';

export function MetadataConflict({ editor }: { editor: ReturnType<typeof useFlightDraft> }) {
  if (!editor.conflict) return editor.error ? <Notice tone="danger" title="Details not saved">{editor.error}</Notice> : null;
  const { saved, fields } = editor.conflict;
  return <View className="gap-[12px]">
    <Notice tone="warning" title="Details changed">{editor.error}</Notice>
    {fields.map(field => <View key={field} className="gap-[4px]">
      <Text className="font-body-semi text-[15px] text-ink">{field === 'notes' ? 'Private notes' : field === 'site' ? 'Site' : 'Title'}</Text>
      <Text selectable className="font-body text-[14px] text-muted">Saved: {saved[field] || 'Empty'}{field === 'site' ? ` · ${siteAttribution(saved.siteSource) || 'No catalogue attribution'}` : ''}</Text>
      <Text selectable className="font-body text-[14px] text-ink">Your draft: {editor.draft[field] || 'Empty'}{field === 'site' ? ` · ${siteAttribution(editor.draft.siteSource) || 'No catalogue attribution'}` : ''}</Text>
    </View>)}
    <Button label="Use saved details" onPress={editor.useSaved} />
    <Button label="Keep my edits" onPress={editor.keepEdits} />
  </View>;
}
