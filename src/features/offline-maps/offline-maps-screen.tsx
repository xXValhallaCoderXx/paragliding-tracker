import { useCallback, useRef, useState } from 'react';
import { BackHandler, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { Button, Notice, Screen, SectionLabel, TopBar } from '@/components/ui';
import { coverageForDestination } from '@/offline-maps/destinations';
import { useOfflineMaps } from '@/offline-maps/runtime';
import type { DestinationSuggestion, OfflineDownloadOptions, OfflineRegion } from '@/offline-maps/types';
import { fonts, paper } from '@/ui/theme';

import { DestinationSearch } from './destination-search';
import { DownloadPreview, type DownloadSelection } from './download-preview';
import { formatMapBytes, offlineOperationError } from './presentation';
import { SavedRegion } from './saved-region';

export function OfflineMapsScreen() {
  const router = useRouter();
  const { service, snapshot, environment } = useOfflineMaps();
  const [selection, setSelection] = useState<DownloadSelection | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [commandBusy, setCommandBusy] = useState(false);
  const commandInFlight = useRef(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const supported = Platform.OS === 'android';
  useFocusEffect(useCallback(() => {
    setFocused(true);
    if (supported) void service.initialize().catch(() => undefined);
    return () => setFocused(false);
  }, [service, supported]));
  useFocusEffect(useCallback(() => {
    if (!selection) return;
    const handler = BackHandler.addEventListener('hardwareBackPress', () => { setSelection(null); return true; });
    return () => handler.remove();
  }, [selection]));

  const run = async (work: () => Promise<void>) => {
    if (commandInFlight.current) return;
    commandInFlight.current = true; setCommandBusy(true); setCommandError(null); setNotice(null);
    try { await work(); }
    catch (error) { setCommandError(offlineOperationError(error)); }
    finally { commandInFlight.current = false; setCommandBusy(false); }
  };
  const selectDestination = (destination: DestinationSuggestion) => {
    try {
      setSelection({ spec: coverageForDestination(destination), action: 'download', regionQuery: destination.regionQuery });
      setCommandError(null); setNotice(null);
    } catch (error) { setCommandError(offlineOperationError(error)); }
  };
  const selectExisting = (region: OfflineRegion, action: 'resume' | 'update') => {
    setSelection({ spec: region.spec, action, regionId: region.id }); setCommandError(null); setNotice(null);
  };
  const confirm = async (options: OfflineDownloadOptions) => {
    if (!selection) return;
    if (selection.action === 'download') {
      const id = await service.download(selection.spec, options);
      const existing = snapshot.regions.find((region) => region.id === id);
      if (existing?.available) setNotice('This area is already covered by your saved maps.');
      else if (existing) setNotice(`This area already has a saved download. Resume ${existing.spec.name} below.`);
    } else if (selection.action === 'update') await service.update(selection.regionId!, options);
    else await service.resume(selection.regionId!, options);
    setSelection(null); setSearchQuery('');
  };
  const back = () => {
    if (selection) setSelection(null);
    else if (router.canGoBack()) router.back();
    else router.replace('/settings');
  };
  const transfer = snapshot.regions.find((region) => region.status === 'downloading' || region.status === 'updating');
  const downloadsBlocked = !snapshot.initialized || snapshot.loading || environment.recorderBusy || !environment.recorderReady || environment.network === 'offline';

  return <Screen>
    <TopBar title="Offline maps" onBack={back} />
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {!supported ? <Notice title="Available on Android">Downloading map areas is currently supported on Android. Saved flight routes remain available on Grid.</Notice> : <>
        {!environment.recorderReady ? <Notice title="Checking recorder status">Downloads are available once the recorder has finished checking or recovering its state. Saved maps remain available.</Notice>
          : environment.recorderBusy ? <Notice title="Downloads paused for recording">Finish or recover the current recording before downloading maps. Saved maps remain available.</Notice>
          : environment.network === 'offline' ? <Notice title="You are offline">Reconnect to search or download. Ready map areas remain available for recording and replay.</Notice> : null}
        {snapshot.error ? <View style={styles.section}><Notice tone="warning" title="Offline maps need attention">{snapshot.error.message}</Notice>
          <Button label="Refresh offline maps" busy={snapshot.loading} onPress={() => void run(() => service.refresh())} /></View> : null}
        {commandError ? <Notice tone="danger">{commandError}</Notice> : null}
        {notice ? <Notice tone="good">{notice}</Notice> : null}
        {transfer ? <Notice title="One download at a time">Pause or finish {transfer.spec.name} before starting another area.</Notice> : null}
        {selection && focused ? <DownloadPreview key={`${selection.action}:${selection.regionId ?? selection.spec.id}`} selection={selection}
          estimate={service.estimate} onConfirm={confirm} disabled={downloadsBlocked || !!transfer}
          onClose={() => setSelection(null)} onBroaderRegion={(query) => { setSearchQuery(query); setSelection(null); }} /> : !selection ? <>
          <Text style={styles.body}>Save places before you travel. Ready areas are used automatically by the live map and saved-flight replay. Recording works outside downloaded coverage, with Grid available.</Text>
          {snapshot.storage ? <Notice title="Map storage on this phone">
            {formatMapBytes(snapshot.storage.usedBytes)} used · {formatMapBytes(snapshot.storage.freeBytes)} free on device. The map total includes shared resources and cache; area sizes are not added together.
          </Notice> : null}
          <View style={styles.section}>
            <SectionLabel>Saved areas</SectionLabel>
            {snapshot.loading ? <Text style={styles.body}>Checking saved map areas…</Text> : null}
            {snapshot.initialized && snapshot.regions.length === 0 ? <Notice>No saved areas yet. Search for your next destination below.</Notice> : null}
            {snapshot.regions.map((region) => <SavedRegion key={region.id} region={region} busy={commandBusy}
              onPause={() => void run(() => service.pause(region.id))} onCancel={() => void run(() => service.cancel(region.id))}
              onRemove={() => void run(() => service.remove(region.id))} onResume={() => selectExisting(region, 'resume')}
              onUpdate={() => selectExisting(region, 'update')} />)}
          </View>
          <DestinationSearch initialQuery={searchQuery} onSelect={selectDestination} />
        </> : null}
      </>}
    </ScrollView>
  </Screen>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 36, gap: 22 },
  section: { gap: 12 }, body: { fontFamily: fonts.sans, fontSize: 14, lineHeight: 21, color: paper.text },
});
