import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
  Alert, AppState, Image, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable,
  ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions,
} from 'react-native';

import { Button, BusyRow, Notice, Screen } from '@/components/ui';
import { errorMessage } from '@/lib/format/error-message';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { useGetFlightQuery, useGetFlightTrackQuery, useGetProfileQuery } from '@/store/endpoints';
import { fonts, paper } from '@/ui/theme';
import { loadPostcardFonts, POSTCARD_ART } from './assets';
import { PostcardExporter } from './export';
import { cleanupPostcards, postcardExportAdapter } from './export-adapter';
import { PostcardCard } from './postcard-card';
import {
  canSharePostcard, CAPTION_LIMIT, initialPostcardDraft, postcardCaption, postcardSource,
  type PostcardDraft, type PostcardScene, type PostcardSource,
} from './presentation';

export function PostcardComposer({ flightId, onClose }: { flightId: string; onClose: () => void }) {
  const [source, setSource] = useState<PostcardSource | null>(null);
  const closeRequestRef = useRef(onClose);
  const reducedMotion = useReducedMotion();
  return (
    <Modal visible presentationStyle="fullScreen" animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={() => closeRequestRef.current()}>
      <Screen>
        {source ? <PostcardEditor source={source} onClose={onClose} closeRequestRef={closeRequestRef} /> : <View style={styles.content}>
          <Text accessibilityRole="header" style={styles.title}>Share postcard</Text>
          <Button label="Cancel" onPress={onClose} />
          <PostcardLoader flightId={flightId} onReady={setSource} />
        </View>}
      </Screen>
    </Modal>
  );
}

/** Unmount the query owner after taking the snapshot; late refreshes cannot alter the image. */
function PostcardLoader({ flightId, onReady }: { flightId: string; onReady: (source: PostcardSource) => void }) {
  const flight = useGetFlightQuery(flightId);
  const track = useGetFlightTrackQuery(flightId);
  const profile = useGetProfileQuery();
  const error = flight.error || track.error;
  const ready = !error && !flight.isFetching && !track.isFetching && !profile.isFetching &&
    flight.currentData && track.currentData !== undefined && canSharePostcard(flight.currentData);
  useEffect(() => {
    if (ready && flight.currentData && track.currentData) {
      onReady(postcardSource(flight.currentData, track.currentData, profile.error ? null : profile.currentData));
    }
  }, [ready, flight.currentData, track.currentData, profile.currentData, profile.error, onReady]);
  if (error) return <>
    <Notice tone="danger" title="Could not load postcard">{errorMessage(error)}</Notice>
    <Button label="Retry" onPress={() => { void flight.refetch(); void track.refetch(); }} />
  </>;
  if (!flight.isFetching && flight.currentData === null) return <Notice>This flight is no longer available.</Notice>;
  if (flight.currentData && !canSharePostcard(flight.currentData)) return <Notice>Postcards are available after the flight statistics are complete.</Notice>;
  return <BusyRow label="Opening postcard…" />;
}

export function PostcardEditor({ source, onClose, closeRequestRef }: {
  source: PostcardSource; onClose: () => void; closeRequestRef?: RefObject<() => void>;
}) {
  const [draft, setDraft] = useState(() => initialPostcardDraft(source));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [fontsReady, setFontsReady] = useState(false);
  const [imageLoaded, setImageLoaded] = useState('');
  const [layout, setLayout] = useState('');
  const [committed, setCommitted] = useState('');
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [exporter] = useState(() => new PostcardExporter());
  const alive = useRef(true);
  const active = useRef(AppState.currentState === 'active');
  const captureView = useRef<View>(null);
  const captureReady = useRef(false);
  const window = useWindowDimensions();
  const width = Math.min(440, Math.max(1, window.width - 36));
  const layoutKey = `${draft.format}:${width}:${attempt}`;
  const imageKey = `${draft.scene}:${layoutKey}`;
  const compositionKey = JSON.stringify([draft, layoutKey]);
  const renderKeys = useRef({ layoutKey, imageKey });
  useLayoutEffect(() => { renderKeys.current = { layoutKey, imageKey }; }, [layoutKey, imageKey]);
  const ready = fontsReady && !assetError && layout === layoutKey && imageLoaded === imageKey && committed === compositionKey && foreground;
  useLayoutEffect(() => { captureReady.current = ready; }, [ready]);

  useEffect(() => {
    let cancelled = false;
    void loadPostcardFonts().then(() => { if (!cancelled) setFontsReady(true); })
      .catch(() => { if (!cancelled) setAssetError('The postcard fonts could not load.'); });
    void cleanupPostcards().catch((cause) => { if (!cancelled) setError(errorMessage(cause)); });
    return () => { cancelled = true; };
  }, [attempt]);

  useEffect(() => {
    alive.current = true;
    const change = AppState.addEventListener('change', (state) => {
      active.current = state === 'active';
      setForeground(active.current);
      if (!active.current) exporter.cancel();
    });
    const blur = Platform.OS === 'android' ? AppState.addEventListener('blur', () => {
      active.current = false; setForeground(false); exporter.cancel();
    }) : null;
    const focus = Platform.OS === 'android' ? AppState.addEventListener('focus', () => {
      active.current = AppState.currentState === 'active'; setForeground(active.current);
    }) : null;
    return () => { alive.current = false; exporter.cancel(); change.remove(); blur?.remove(); focus?.remove(); };
  }, [exporter]);

  useLayoutEffect(() => {
    // A rotation/format/asset change during preparation invalidates that operation too.
    exporter.cancel();
    if (!fontsReady || assetError || layout !== layoutKey || imageLoaded !== imageKey) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setCommitted(compositionKey));
    });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [compositionKey, layoutKey, imageKey, layout, imageLoaded, fontsReady, assetError, exporter]);

  function edit(patch: Partial<PostcardDraft>) {
    if (exporter.busy) return;
    captureReady.current = false;
    setError(null);
    setDraft((previous) => ({ ...previous, ...patch }));
  }
  const close = useCallback(() => {
    exporter.cancel();
    alive.current = false;
    onClose();
  }, [exporter, onClose]);
  const cancel = useCallback(() => {
    exporter.cancel();
    if (!draft.caption.length) return close();
    Alert.alert('Discard postcard caption?', 'This caption is only on your postcard.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: close },
    ]);
  }, [close, draft.caption, exporter]);
  useLayoutEffect(() => { if (closeRequestRef) closeRequestRef.current = cancel; }, [cancel, closeRequestRef]);
  async function share() {
    if (exporter.busy || !captureReady.current || !active.current || !alive.current) return;
    Keyboard.dismiss();
    setBusy(true); setError(null);
    try { await exporter.run(postcardExportAdapter(captureView, draft.format)); }
    catch (cause) { if (alive.current) setError(errorMessage(cause)); }
    finally { if (alive.current) setBusy(false); }
  }
  return (
    <View style={styles.flex}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>Share postcard</Text>
          <Button label="Cancel" onPress={cancel} />
        </View>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <ScrollView removeClippedSubviews={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={{ alignItems: 'center' }}>
              <PostcardCard key={layoutKey} source={source} draft={draft} width={width} captureView={captureView}
                onLayout={() => { if (renderKeys.current.layoutKey === layoutKey) setLayout(layoutKey); }}
                onImageLoad={() => { if (renderKeys.current.imageKey === imageKey) setImageLoaded(imageKey); }}
                onImageError={() => {
                  if (renderKeys.current.imageKey !== imageKey) return;
                  captureReady.current = false; setImageLoaded(''); setAssetError('The illustration could not load.');
                }} />
            </View>
            <Text style={styles.hint}>Your image will look like this preview. Long text ends with an ellipsis.</Text>
            {assetError ? <>
              <Notice tone="danger" title="Could not prepare preview">{assetError}</Notice>
              <Button label="Retry preview" disabled={busy} onPress={() => { setAssetError(null); setFontsReady(false); setAttempt((value) => value + 1); }} />
            </> : null}
            <Text style={styles.label}>Scene</Text>
            <View style={styles.choices}>
              {(Object.keys(POSTCARD_ART) as PostcardScene[]).map((scene) => (
                <Pressable key={scene} accessibilityRole="radio" accessibilityLabel={scene === 'flying' ? 'Flying' : scene === 'launch' ? 'Launch' : 'Landing'}
                  accessibilityState={{ selected: draft.scene === scene, disabled: busy }} disabled={busy}
                  onPress={() => edit({ scene })} style={[styles.scene, draft.scene === scene && styles.selected, busy && styles.disabled]}>
                  <Image source={POSTCARD_ART[scene]} style={styles.thumbnail} accessible={false} />
                  <Text style={styles.choiceLabel}>{scene === 'flying' ? 'Flying' : scene === 'launch' ? 'Launch' : 'Landing'}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>Format</Text>
            <View style={styles.choices}>
              {(['square', 'story'] as const).map((format) => (
                <Pressable key={format} accessibilityRole="radio" accessibilityLabel={format === 'square' ? 'Square' : 'Story'}
                  accessibilityState={{ selected: draft.format === format, disabled: busy }} disabled={busy}
                  onPress={() => edit({ format })} style={[styles.format, draft.format === format && styles.selected, busy && styles.disabled]}>
                  <Text style={styles.choiceLabel}>{format === 'square' ? 'Square · 1:1' : 'Story · 9:16'}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>Caption · optional</Text>
            <TextInput accessibilityLabel="Postcard caption" multiline editable={!busy} value={draft.caption}
              placeholder="A moment to remember…" placeholderTextColor={paper.muted} style={styles.input}
              onChangeText={(caption) => edit({ caption: postcardCaption(caption) })} />
            <Text style={styles.hint}>{Array.from(draft.caption).length}/{CAPTION_LIMIT} · Only on this postcard</Text>
            {source.pilotName ? <View style={styles.signature}>
              <Text style={[styles.label, styles.flex]}>Add pilot signature</Text>
              <Switch accessibilityLabel="Add pilot signature" value={draft.signature} disabled={busy}
                onValueChange={(signature) => edit({ signature })} trackColor={{ true: paper.ink }} />
            </View> : null}
            {error ? <Notice tone="danger" title="Could not share postcard">{error}</Notice> : null}
            <Button label={busy ? 'Preparing postcard…' : error ? 'Retry sharing' : 'Share image'} variant="primary" size="xl"
              busy={busy} disabled={!ready || busy} onPress={() => void share()} />
            <Text style={styles.hint}>Opens your phone’s share menu. The postcard stays here when you return.</Text>
          </ScrollView>
        </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 10, gap: 10 },
  content: { padding: 18, paddingBottom: 40, gap: 12 },
  title: { fontFamily: fonts.sansBold, color: paper.ink, fontSize: 28 },
  label: { fontFamily: fonts.sansBold, color: paper.ink, fontSize: 16 },
  hint: { fontFamily: fonts.sans, color: paper.muted, fontSize: 13, lineHeight: 19 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  scene: { flexGrow: 1, flexBasis: 96, padding: 5, borderWidth: 2, borderColor: paper.border, borderRadius: 14, gap: 8 },
  selected: { borderColor: paper.thermal, backgroundColor: paper.thermalSoft },
  disabled: { opacity: 0.5 },
  thumbnail: { width: '100%', height: 64, borderRadius: 8 },
  choiceLabel: { fontFamily: fonts.sans, color: paper.ink, fontSize: 15, textAlign: 'center', paddingVertical: 5 },
  format: { flexGrow: 1, flexBasis: 140, minHeight: 48, justifyContent: 'center', borderWidth: 2, borderColor: paper.border, borderRadius: 14, padding: 8 },
  input: { minHeight: 108, padding: 14, fontFamily: fonts.sans, fontSize: 16, color: paper.ink, borderWidth: 1, borderColor: paper.border, borderRadius: 14, backgroundColor: paper.card, textAlignVertical: 'top' },
  signature: { flexDirection: 'row', alignItems: 'center', gap: 16 },
});
