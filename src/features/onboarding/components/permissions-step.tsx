import { StyleSheet, Text, View } from 'react-native';
import { Button, Card, Disclaimer, LinkButton, ListRow, Notice } from '@/components/ui';
import { locationAction, type LocationAccess } from '@/lib/location-permission';
import { paper, spacing, typography } from '@/ui/theme';
import { useSetupPermissions } from '../use-setup-permissions';

function accessLabel(access: LocationAccess | undefined, checking: boolean, foreground = false): string {
  if (checking) return 'CHECKING';
  if (!access || access.status === 'unavailable') return 'UNAVAILABLE';
  if (access.status === 'granted') {
    if (!foreground) return 'ALLOWED';
    return access.accuracy === 'precise' ? 'PRECISE' : access.accuracy === 'approximate' ? 'APPROXIMATE' : 'ACCURACY UNKNOWN';
  }
  return access.status === 'denied' ? 'NOT ALLOWED' : 'NOT REQUESTED';
}

export function PermissionsStep({ onContinue }: { onContinue: () => void }) {
  const { permissions, notifications, busy, checking, error, refresh, perform } = useSetupPermissions();
  const action = locationAction(permissions);
  const label = checking ? 'Checking permissions…' : action === 'done' ? 'Continue'
    : action === 'location-settings' ? 'Open location settings'
      : action === 'app-settings' ? 'Open app settings'
        : action === 'retry' || action === 'checking' ? 'Retry permission check'
          : permissions?.foreground.status === 'denied' || permissions?.background.status === 'denied'
            ? 'Retry location permission' : 'Allow location';
  const notificationLabel = notifications === 'granted' ? 'ALLOWED' : notifications === 'unsupported' ? 'NOT NEEDED'
    : notifications === 'unavailable' ? 'UNAVAILABLE'
      : notifications === 'denied' || notifications === 'blocked' ? 'NOT ALLOWED' : 'OPTIONAL';

  function locationPress() {
    if (busy || checking) return;
    if (action === 'done') onContinue();
    else if (action === 'retry' || action === 'checking') void refresh();
    else void perform(action === 'request' ? 'location' : action);
  }

  return (
    <View style={styles.block}>
      <Text style={styles.eyebrow}>BEFORE YOU LAUNCH</Text>
      <Text accessibilityRole="header" style={styles.heading}>Give your journal a position.</Text>
      <Text style={styles.body}>Location permission lets the recorder capture GPS fixes. Precise and background access are required before recording. Permission does not guarantee uninterrupted recording.</Text>
      <Card className="px-[16px] py-[4px]">
        <ListRow label="Location · precise" value={accessLabel(permissions?.foreground, checking, true)}
          tone={permissions?.foreground.accuracy === 'precise' ? 'good' : 'neutral'} showDot
          detail="Approximate location is not enough for this recorder. Choose precise location in the permission prompt or app settings." />
        <ListRow label="Allow all the time" value={accessLabel(permissions?.background, checking)}
          tone={permissions?.background.status === 'granted' ? 'good' : 'neutral'} showDot
          detail="Background access lets capture continue when the app is not visible. Android may open a second screen: choose Allow all the time." />
        <ListRow label="Device location" value={checking ? 'CHECKING' : permissions?.servicesEnabled === true ? 'ON' : permissions?.servicesEnabled === false ? 'OFF' : 'UNAVAILABLE'}
          detail="Your phone’s location service must be on, separately from this app’s permission." />
        <ListRow label="Notifications" value={checking ? 'CHECKING' : notificationLabel}
          detail="Optional. Makes recording status visible. Notifications do not stop Android from ending capture." last />
        {notifications !== 'granted' && notifications !== 'unsupported' ? (
          <LinkButton label={notifications === 'unavailable' ? 'Retry notification check' : notifications === 'blocked' ? 'Open notification settings' : notifications === 'denied' ? 'Retry notifications' : 'Allow notifications — optional'}
            disabled={busy || checking} onPress={() => {
              if (notifications === 'unavailable') void refresh();
              else void perform(notifications === 'blocked' ? 'app-settings' : 'notifications');
            }} />
        ) : null}
      </Card>
      {permissions?.servicesEnabled === false ? <Notice tone="warning" title="Device location is off">Turn it on in your phone’s location settings before recording.</Notice> : null}
      {action === 'retry' && !checking ? <Notice title="Some permission details are unavailable">Retry the check, or finish setup and check again before recording.</Notice> : null}
      {error ? <Notice tone="danger" title="Permission action did not finish">{error}</Notice> : null}
      {error ? <LinkButton label="Retry permission check" disabled={busy || checking} onPress={() => void refresh()} /> : null}
      <Disclaimer align="left">You can finish setup now. Before a flight, the recorder will check access again.</Disclaimer>
      <View style={styles.actions}>
        <Button label={busy ? 'Please wait…' : label} variant="primary" size="lg" busy={busy} disabled={checking} onPress={locationPress} />
        <LinkButton label="Not now — continue setup" onPress={onContinue} />
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  block: { paddingHorizontal: spacing.screen, gap: spacing.section },
  eyebrow: { ...typography.eyebrow, color: paper.actionText },
  heading: { ...typography.title, color: paper.ink },
  body: { ...typography.body, color: paper.text },
  actions: { paddingTop: spacing.action, gap: spacing.tight },
});
