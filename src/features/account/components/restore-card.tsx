import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { Button, Card, Notice } from '@/components/ui';
import type { RestorePauseReason, RestoreSnapshot } from '@/cloud/restore-plan';
import { fonts, paper } from '@/ui/theme';

const PAUSE_COPY: Record<RestorePauseReason, string> = {
  user: 'Restoration is paused. Downloaded flights remain available.',
  wifi: 'Waiting for Wi-Fi. You can allow mobile data for this restore.',
  offline: 'Connect to Wi-Fi to continue downloading archived routes.',
  background: 'Return to the app to continue restoration.',
  recording: 'Restoration waits while you record. Your flight comes first.',
  recovering: 'Waiting for the recorder to finish checking the last flight.',
  storage: 'Free some space on this phone, then retry restoration.',
  signed_out: 'Sign in to continue restoration. Downloaded flights remain available.',
};

export function RestoreCard({ restore, onPause, onResume, onRetry }: {
  restore: RestoreSnapshot;
  onPause: () => void;
  onResume: (options: { allowMobileData: boolean }) => void;
  onRetry: (options: { allowMobileData: boolean }) => void;
}) {
  const [allowMobileData, setAllowMobileData] = useState(false);
  const active = restore.phase === 'restoring';
  const retry = restore.phase === 'error' || restore.pauseReason === 'storage';
  const waiting = restore.phase === 'paused' || retry;
  const blocked = restore.pauseReason !== null && ['offline', 'background', 'recording', 'recovering', 'signed_out'].includes(restore.pauseReason);
  const title = active ? 'Restoring flights…' : waiting ? 'Restoration paused' : 'Flight restoration';
  const resume = () => {
    (retry ? onRetry : onResume)({ allowMobileData });
    setAllowMobileData(false);
  };

  return <Card className="p-[16px] gap-[12px]">
    <Text style={styles.title}>{title}</Text>
    <Text style={styles.copy}>
      {restore.total > 0 ? `${restore.completed} of ${restore.total} archived routes saved on this phone.`
        : 'Flights from your account appear automatically in your logbook. Archived routes download over Wi-Fi by default.'}
    </Text>
    {active && restore.currentFlightTitle ? <Text style={styles.copy}>{restore.currentFlightTitle}</Text> : null}
    {active && restore.downloadedBytes !== null ? <Text style={styles.copy}>
      {(restore.downloadedBytes / 1024).toFixed(0)} KB{restore.totalBytes === null ? '' : ` of ${(restore.totalBytes / 1024).toFixed(0)} KB`}
    </Text> : null}
    {restore.pauseReason ? <Text style={styles.copy}>{PAUSE_COPY[restore.pauseReason]}</Text> : null}
    {restore.lastError ? <Notice tone="danger">{restore.lastError}</Notice> : null}
    {active && restore.allowMobileData ? <Text style={styles.copy}>Mobile data is allowed for this restore.</Text> : null}
    {active ? <Button label="Pause restoration" onPress={onPause} /> : null}
    {waiting ? <>
      <View style={styles.consent}>
        <Text style={[styles.copy, styles.label]}>Allow mobile data for this restore</Text>
        <Switch accessibilityLabel="Allow mobile data for this restore" value={allowMobileData}
          onValueChange={setAllowMobileData} disabled={blocked} />
      </View>
      <Button label={retry ? 'Retry restoration' : 'Resume restoration'} disabled={blocked} onPress={resume} />
    </> : null}
    <Text style={styles.copy}>Downloaded flights remain available offline. Original sensor data and recorder diagnostics are not restored.</Text>
  </Card>;
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.sansSemi, fontSize: 16, color: paper.ink },
  copy: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19, color: paper.muted },
  consent: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { flex: 1 },
});
