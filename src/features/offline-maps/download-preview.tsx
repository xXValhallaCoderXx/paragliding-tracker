import { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, Switch, Text, View } from 'react-native';

import { Button, LinkButton, Notice, SectionLabel } from '@/components/ui';
import { DESTINATION_ATTRIBUTION_URL } from '@/offline-maps/destinations';
import type { OfflineDownloadOptions, OfflineEstimate, OfflineRegionSpec } from '@/offline-maps/types';
import { fonts, paper } from '@/ui/theme';

import { CoveragePreview } from './coverage-preview';
import { estimateRange, formatMapBytes, offlineOperationError } from './presentation';

export interface DownloadSelection {
  spec: OfflineRegionSpec;
  action: 'download' | 'update' | 'resume';
  regionId?: string;
  regionQuery?: string;
}

export function DownloadPreview({ selection, estimate, onConfirm, onBroaderRegion, onClose, disabled = false }: {
  selection: DownloadSelection;
  estimate: (spec: OfflineRegionSpec, signal: AbortSignal) => Promise<OfflineEstimate>;
  onConfirm: (options: OfflineDownloadOptions) => Promise<void>;
  onBroaderRegion: (query: string) => void;
  onClose: () => void;
  disabled?: boolean;
}) {
  const [estimateResult, setEstimateResult] = useState<OfflineEstimate | null>(null);
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [estimating, setEstimating] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [allowMobileData, setAllowMobileData] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    void estimate(selection.spec, controller.signal).then((value) => {
      if (!controller.signal.aborted) setEstimateResult(value);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setEstimateError(offlineOperationError(error));
    }).finally(() => { if (!controller.signal.aborted) setEstimating(false); });
    return () => controller.abort();
  }, [selection.spec, attempt, estimate]);

  const submit = async (allowUnknownEstimate: boolean) => {
    if (submittingRef.current || disabled || estimating) return;
    submittingRef.current = true; setSubmitting(true); setActionError(null);
    try {
      await onConfirm({ allowMobileData, allowUnknownEstimate, ...(estimateResult ? { estimate: estimateResult } : {}) });
    } catch (error) {
      if (mounted.current) setActionError(offlineOperationError(error));
    } finally {
      submittingRef.current = false;
      if (mounted.current) setSubmitting(false);
    }
  };
  const verb = selection.action === 'update' ? 'Update' : selection.action === 'resume' ? 'Resume' : 'Download';
  return <View style={styles.section}>
    <SectionLabel>{verb} map area</SectionLabel>
    <Text style={styles.heading}>{selection.spec.name}</Text>
    {selection.spec.context ? <Text style={styles.body}>{selection.spec.context}</Text> : null}
    <CoveragePreview spec={selection.spec} />
    {selection.spec.name.startsWith('Around ') ? <Text style={styles.body}>Local coverage extends approximately 25 km north, south, east and west of the selected place.</Text> : null}
    {selection.regionQuery ? <LinkButton label="Search a broader region" disabled={submitting}
      onPress={() => onBroaderRegion(selection.regionQuery!)} /> : null}
    {estimating ? <Notice title="Estimating download…">Checking the size of this map area.</Notice>
      : estimateResult ? <Notice title={`Estimated download: ${estimateRange(estimateResult)}`}>
        Estimated map data: {formatMapBytes(estimateResult.storageBytes)}. Style resources can add to this. Shared map data is reused, so extra storage may be lower.
      </Notice> : <View style={styles.section}>
        <Notice tone="warning" title="Size estimate unavailable">{estimateError ?? 'The provider could not estimate this area.'} You can retry or explicitly download without an estimate.</Notice>
        <Button label="Retry estimate" disabled={submitting} onPress={() => {
          setEstimating(true); setEstimateError(null); setEstimateResult(null); setAttempt((value) => value + 1);
        }} />
      </View>}
    <View style={styles.mobileRow}>
      <View style={styles.mobileCopy}><Text style={styles.label}>Allow mobile data for this download</Text>
        <Text style={styles.hint}>Wi-Fi is used by default. Mobile downloads can use a lot of data.</Text></View>
      <Switch value={allowMobileData} onValueChange={setAllowMobileData} disabled={submitting}
        accessibilityLabel="Allow mobile data for this download" trackColor={{ true: paper.thermal, false: paper.border }} />
    </View>
    <Text style={styles.body}>Keep the app open while downloading. Leaving the app or starting a recording pauses the transfer; resume it here when ready.</Text>
    {actionError ? <Notice tone="danger" title="Download could not start">{actionError}</Notice> : null}
    <Button label={estimateResult ? `${verb} area` : `${verb} without estimate`} variant="primary"
      disabled={disabled || estimating} busy={submitting} onPress={() => void submit(estimateResult === null)} />
    <Button label="Back to saved maps" disabled={submitting} onPress={onClose} />
    <LinkButton label={selection.spec.attribution} onPress={() => { void Linking.openURL(DESTINATION_ATTRIBUTION_URL).catch(() => undefined); }} />
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 14 }, heading: { fontFamily: fonts.sansSemi, fontSize: 23, color: paper.ink },
  body: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19, color: paper.text },
  hint: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 17, color: paper.muted },
  label: { fontFamily: fonts.sansSemi, fontSize: 14, lineHeight: 20, color: paper.ink },
  mobileRow: { flexDirection: 'row', alignItems: 'center', gap: 12 }, mobileCopy: { flex: 1, gap: 4 },
});
