import { useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Platform, ScrollView, Text, View } from 'react-native';
import { Button, Input, Notice, Screen, SectionLabel } from '@/components/ui';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { formatDistance } from '@/lib/format/flight-format';
import { fetchNearbySites, searchSitesByName } from '@/sites/site-service';
import { attributionFor, roundNear, MINIMUM_QUERY_LENGTH } from '@/sites/site-plan';
import type { Coordinate, SiteSuggestion } from '@/sites/types';
import type { SiteSource } from '@/recorder/types';
import { readCoarsePosition } from '../current-position';

/** A nested draft: nothing reaches the parent until a deliberate selection. */
export function SitePickerSheet({ site, source, near, onSelect, onClose }: {
  site: string; source: SiteSource | null; near: Coordinate | null;
  onSelect: (site: string, source: SiteSource | null) => void; onClose: () => void;
}) {
  const [query, setQuery] = useState(site);
  const [selectionSource, setSelectionSource] = useState(source);
  const [position, setPosition] = useState(near);
  const [mode, setMode] = useState<'nearby' | 'search'>(near ? 'nearby' : 'search');
  const [results, setResults] = useState<SiteSuggestion[]>([]);
  const [loading, setLoading] = useState(Boolean(near) || site.trim().length >= MINIMUM_QUERY_LENGTH);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [retry, setRetry] = useState(0);
  const active = useRef(true);
  const lookup = useRef<AbortController | null>(null);
  const location = useRef<AbortController | null>(null);
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; lookup.current?.abort(); location.current?.abort(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController(); lookup.current = controller;
    const wanted = mode === 'nearby' ? Boolean(position) : query.trim().length >= MINIMUM_QUERY_LENGTH;
    const timer = setTimeout(() => {
      if (!active.current || controller.signal.aborted) return;
      setResults([]); setError(null); setLoading(wanted);
      if (!wanted) return;
      const near = position ? roundNear(position) : null;
      const work = mode === 'nearby' ? fetchNearbySites(near!, { signal: controller.signal })
        : searchSitesByName(query, { near, signal: controller.signal });
      void work.then(value => { if (active.current && !controller.signal.aborted) setResults(value); }, () => {
        if (active.current && !controller.signal.aborted) setError('Site lookup is unavailable. You may be offline. Type a name to save it manually, or retry.');
      }).finally(() => { if (active.current && !controller.signal.aborted) setLoading(false); });
    }, mode === 'search' ? 350 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [mode, position, query, retry]);
  const close = () => {
    if (!active.current) return;
    active.current = false; lookup.current?.abort(); location.current?.abort(); Keyboard.dismiss(); onClose();
  };
  const select = (name: string, provenance: SiteSource | null) => {
    if (!active.current) return;
    onSelect(name.trim(), name.trim() ? provenance ?? 'manual' : null); close();
  };
  const locate = async () => {
    if (!active.current || location.current || near) return;
    const controller = new AbortController(); location.current = controller; setLocating(true);
    const value = await readCoarsePosition(8000, controller.signal);
    if (!active.current || controller.signal.aborted) return;
    location.current = null; setLocating(false);
    if (value) { setPosition(value); setMode('nearby'); }
    else setError('Current location is unavailable. You can still search or type a site name.');
  };
  const credit = attributionFor(results);
  return <Modal visible animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={() => {
    if (Keyboard.isVisible()) { Keyboard.dismiss(); return; } close();
  }}>
    <Screen>
      <View className="gap-[10px] px-[18px] py-[12px]">
        <Text accessibilityRole="header" className="font-body-bold text-[26px] text-ink">Choose a site</Text>
        <Button label="Cancel site selection" onPress={close} />
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18, gap: 14, paddingBottom: 32 }}>
          <Input label="Site name or search" value={query} maxLength={120} placeholder="Type a place or your own name" onChangeText={value => {
            lookup.current?.abort(); setResults([]); setError(null); setLoading(value.trim().length >= MINIMUM_QUERY_LENGTH); setQuery(value); setSelectionSource(null); setMode('search');
          }} />
          {position ? <Button label={near ? 'Near the recording start' : 'Near my current location'} onPress={() => { setMode('nearby'); setRetry(value => value + 1); }} /> : null}
          <SectionLabel>{mode === 'nearby' ? 'Nearby sites' : 'Matching places'}</SectionLabel>
          {loading ? <Text accessibilityLiveRegion="polite" className="font-body text-[15px] text-muted">Looking for sites…</Text> : null}
          {error ? <><Notice tone="warning">{error}</Notice><Button label="Retry site lookup" onPress={() => setRetry(value => value + 1)} /></> : null}
          {!loading && !error && results.length === 0 ? <Text className="font-body text-[15px] text-muted">{mode === 'search' && query.trim().length < MINIMUM_QUERY_LENGTH ? `Type at least ${MINIMUM_QUERY_LENGTH} characters to search. You can use any name manually.` : 'No sites found. You can use the name you typed.'}</Text> : null}
          {results.map(result => <View key={result.id} className="gap-[4px]">
            <Button label={result.name} onPress={() => select(result.name, result.provider)} accessibilityHint={result.detail ?? 'Select this site'} />
            {result.detail || result.distanceMetres !== null ? <Text className="font-body text-[12px] text-muted">{[result.distanceMetres === null ? null : formatDistance(result.distanceMetres), result.detail].filter(Boolean).join(' · ')}</Text> : null}
          </View>)}
          {credit ? <Text className="font-body text-[12px] text-muted">{credit}</Text> : null}
          {!near ? <Button label={locating ? 'Finding your location…' : 'Use my current location'} busy={locating} onPress={() => void locate()} /> : null}
        </ScrollView>
        <View className="gap-[8px] border-t border-border bg-paper px-[18px] py-[12px]">
          <Button label="Use this site name" variant="primary" disabled={!query.trim()} onPress={() => select(query, selectionSource)} />
          <Button label="Clear site" onPress={() => select('', null)} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  </Modal>;
}
