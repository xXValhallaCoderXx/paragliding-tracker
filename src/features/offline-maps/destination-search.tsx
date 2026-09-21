import { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { Button, Card, Input, LinkButton, Notice, SectionLabel } from '@/components/ui';
import { DESTINATION_ATTRIBUTION, DESTINATION_ATTRIBUTION_URL, destinationSearchError, normalizeDestinationQuery, searchDestinations } from '@/offline-maps/destinations';
import type { DestinationSuggestion } from '@/offline-maps/types';
import { fonts, paper } from '@/ui/theme';

export function DestinationSearch({ initialQuery = '', onSelect }: { initialQuery?: string; onSelect: (destination: DestinationSuggestion) => void }) {
  const [query, setQuery] = useState(initialQuery);
  const [submitted, setSubmitted] = useState(initialQuery);
  const [results, setResults] = useState<DestinationSuggestion[]>([]);
  const [busy, setBusy] = useState(!!initialQuery);
  const [error, setError] = useState<string | null>(null);
  const [request, setRequest] = useState<{ query: string } | null>(initialQuery ? { query: initialQuery } : null);
  const requestController = useRef<AbortController | null>(null);
  const lastSentAt = useRef<number | null>(null);
  const search = (value: string) => {
    if (value.trim().length < 2) { setError('Enter at least two characters to search for a destination.'); return; }
    if (lastSentAt.current !== null && Date.now() - lastSentAt.current < 1_000) {
      setError('Wait a moment before searching again.'); return;
    }
    requestController.current?.abort();
    lastSentAt.current = Date.now();
    setSubmitted(value.trim()); setQuery(value); setBusy(true); setError(null); setResults([]);
    setRequest({ query: value });
  };
  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    requestController.current = controller;
    void searchDestinations(request.query, { signal: controller.signal }).then((matches) => {
      if (!controller.signal.aborted) setResults(matches);
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(destinationSearchError(failure));
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [request]);
  const normalized = normalizeDestinationQuery(submitted);
  const alternate = /\bbubos\b/i.test(submitted) ? 'Bukit Bubus, Terengganu' : null;
  return <View style={styles.section}>
    <SectionLabel>Find a destination</SectionLabel>
    <Card className="px-[16px] pb-[12px]">
      <Input label="Destination" value={query} placeholder="Town, region, country or flying site" maxLength={160}
        returnKeyType="search" onChangeText={(value) => {
          requestController.current?.abort(); setRequest(null); setBusy(false); setError(null); setResults([]); setSubmitted(''); setQuery(value);
        }} onSubmitEditing={() => { if (!busy) void search(query); }}
        hint="Search online, then choose the coverage to save on this phone." last />
      <Button label="Search destinations" busy={busy} onPress={() => void search(query)} />
    </Card>
    {normalized.expandedFrom ? <Text style={styles.body}>Searching for {normalized.query} ({normalized.expandedFrom}).</Text> : null}
    {error ? <View style={styles.section}><Notice tone="warning" title="Search unavailable">{error}</Notice>
      <Button label="Retry search" onPress={() => void search(query)} /></View> : null}
    {!busy && !error && submitted && results.length === 0 ? <Notice title="No matching destinations">
      Try the full place name or its town, region and country.
    </Notice> : null}
    {alternate && !busy ? <LinkButton label={`Search ${alternate} instead`} onPress={() => void search(alternate)} /> : null}
    {results.map((destination) => <Card key={destination.id} className="p-[16px]">
      <View style={styles.section}>
        <Text style={styles.name}>{destination.name}</Text>
        <Text style={styles.body}>{destination.context || 'Location context unavailable'} · {destination.kind === 'terrain' ? 'Flying-area landmark' : destination.kind}</Text>
        <Button label={`Preview ${destination.name}`} onPress={() => onSelect(destination)} />
      </View>
    </Card>)}
    {results.length > 0 ? <LinkButton label={DESTINATION_ATTRIBUTION}
      onPress={() => { void Linking.openURL(DESTINATION_ATTRIBUTION_URL).catch(() => undefined); }} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12 }, name: { fontFamily: fonts.sansSemi, fontSize: 17, color: paper.ink },
  body: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19, color: paper.text },
});
