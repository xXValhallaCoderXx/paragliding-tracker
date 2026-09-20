import { Alert, Linking, StyleSheet, Text, View } from 'react-native';

import { Button, Card, LinkButton, Meter, Notice } from '@/components/ui';
import { DESTINATION_ATTRIBUTION_URL } from '@/offline-maps/destinations';
import type { OfflineRegion } from '@/offline-maps/types';
import { fonts, paper } from '@/ui/theme';

import { formatMapBytes, offlineRegionStatus } from './presentation';

export function SavedRegion({ region, busy, onPause, onCancel, onResume, onUpdate, onRemove }: {
  region: OfflineRegion; busy: boolean;
  onPause: () => void; onCancel: () => void; onResume: () => void; onUpdate: () => void; onRemove: () => void;
}) {
  const transferring = region.status === 'downloading' || region.status === 'updating';
  const incomplete = region.status === 'paused' || region.status === 'error';
  const deleting = region.status === 'deleting';
  const progress = region.progress;
  return <Card className="p-[16px]"><View style={styles.section}>
    <Text style={styles.name}>{region.spec.name}</Text>
    {region.spec.context ? <Text style={styles.body}>{region.spec.context}</Text> : null}
    <Text accessibilityLiveRegion="polite" style={styles.status}>{offlineRegionStatus(region)}</Text>
    {region.available ? <Text style={styles.body}>Used automatically for recording and saved-flight replay. {region.completedAt ? `Saved ${new Date(region.completedAt).toLocaleDateString()}.` : 'Update time unavailable.'}</Text> : null}
    {progress && region.status !== 'ready' && !deleting ? <View style={styles.section}>
      <Meter value={progress.requiredResources > 0 ? Math.min(99, progress.completedResources / progress.requiredResources * 100) : 0} max={100} />
      <Text style={styles.body}>{formatMapBytes(progress.completedBytes)} of map resources{progress.requiredResources > 0 ? ` · ${Math.min(99, Math.floor(progress.completedResources / progress.requiredResources * 100))}%` : ''}</Text>
    </View> : null}
    {region.error ? <Notice tone="warning">{region.error.message}</Notice> : null}
    {deleting && !region.error ? <Notice>
      Deletion waits until the recorder is ready and idle. Saved map data remains on this phone while deletion is waiting.
    </Notice> : null}
    {transferring ? <>
      <Button label={`Pause ${region.spec.name}`} disabled={busy} onPress={onPause} />
      <Button label={`Cancel ${region.status === 'updating' ? 'update' : 'download'}`} variant="ghost" disabled={busy} onPress={onCancel} />
    </> : null}
    {incomplete ? <>
      <Button label={region.status === 'error' ? `Retry ${region.spec.name}` : `Resume ${region.spec.name}`} disabled={busy} onPress={onResume} />
      {region.pendingNativeId ? <Button label="Cancel unfinished download" variant="ghost" disabled={busy} onPress={onCancel} /> : null}
    </> : null}
    {region.status === 'ready' && region.available ? <Button label={`Update ${region.spec.name}`} disabled={busy} onPress={onUpdate} /> : null}
    {deleting ? region.error ? <Button label="Retry delete" variant="danger" disabled={busy} onPress={onRemove} /> : null
      : <Button label={`Delete ${region.spec.name}`} variant="danger" disabled={busy || transferring}
      onPress={() => Alert.alert(`Delete ${region.spec.name}?`, 'Remove this saved map area from this phone. Shared map data needed by other saved areas is retained. Your flights are kept.', [
        { text: 'Keep map', style: 'cancel' }, { text: 'Delete map', style: 'destructive', onPress: onRemove },
      ])} />}
    <LinkButton label={region.spec.attribution} onPress={() => { void Linking.openURL(DESTINATION_ATTRIBUTION_URL).catch(() => undefined); }} />
  </View></Card>;
}

const styles = StyleSheet.create({
  section: { gap: 10 }, name: { fontFamily: fonts.sansSemi, fontSize: 18, color: paper.ink },
  status: { fontFamily: fonts.sansSemi, fontSize: 13, lineHeight: 19, color: paper.ink },
  body: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19, color: paper.text },
});
