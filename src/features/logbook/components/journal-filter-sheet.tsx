import { useMemo, useRef, useState } from 'react';
import {
  Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';

import { Button, Input, Screen } from '@/components/ui';
import {
  defaultJournalCriteria, JOURNAL_SORT_OPTIONS, selectJournal,
  type JournalCriteria, type JournalFacetOption,
} from '@/features/logbook/journal-query';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import type { FlightSummary } from '@/recorder/types';
import { fonts, paper } from '@/ui/theme';

const COLLAPSED_OPTIONS = 3;
const EXPANDED_PAGE_SIZE = 50;
const copyCriteria = (criteria: JournalCriteria): JournalCriteria => ({
  ...criteria, sites: [...criteria.sites], sports: [...criteria.sports],
  aircraft: [...criteria.aircraft], qualities: [...criteria.qualities],
});
const toggle = <T extends string>(values: T[], value: T): T[] => values.includes(value)
  ? values.filter((item) => item !== value) : [...values, value];

/** The parent mounts one sheet per visit. Only Apply publishes this local draft. */
export function JournalFilterSheet({ flights, criteria, onApply, onClose }: {
  flights: FlightSummary[];
  criteria: JournalCriteria;
  onApply: (criteria: JournalCriteria) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => copyCriteria(criteria));
  const [currentYear] = useState(() => new Date().getFullYear());
  const submitted = useRef(false);
  const reducedMotion = useReducedMotion();
  const result = useMemo(() => selectJournal(flights, draft, currentYear), [flights, draft, currentYear]);
  const cancel = () => { Keyboard.dismiss(); onClose(); };
  const hardwareBack = () => {
    if (Keyboard.isVisible()) { Keyboard.dismiss(); return; }
    onClose();
  };
  const apply = () => {
    if (submitted.current) return;
    submitted.current = true;
    Keyboard.dismiss();
    onApply(copyCriteria(draft));
  };
  return <Modal visible animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={hardwareBack}>
    <Screen>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>Filter flights</Text>
        <View style={styles.headerActions}>
          <Button label="Cancel" variant="ghost" onPress={cancel} />
          <Button label="Reset" variant="secondary" onPress={() => setDraft(defaultJournalCriteria())}
            accessibilityHint="Resets this draft to all flights, all time, newest first. Apply to update Home." />
        </View>
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <Text style={styles.hint}>Choose any options within a group. Flights must match every group you choose.</Text>
          <MultiSelect title="Sport" options={result.facets.sports} selected={draft.sports}
            onToggle={(value) => setDraft((previous) => ({ ...previous, sports: toggle(previous.sports, value) }))} />
          <SearchableMultiSelect title="Site" plural="sites" options={result.facets.sites} selected={draft.sites}
            onToggle={(value) => setDraft((previous) => ({ ...previous, sites: toggle(previous.sites, value) }))} />
          <SearchableMultiSelect title="Aircraft" plural="aircraft" options={result.facets.aircraft} selected={draft.aircraft}
            onToggle={(value) => setDraft((previous) => ({ ...previous, aircraft: toggle(previous.aircraft, value) }))} />
          <View style={styles.section}>
            <SectionTitle>When</SectionTitle>
            <View style={styles.options}>
              <Choice label="All time" selected={draft.year === null} role="radio" group="Year"
                onPress={() => setDraft((previous) => ({ ...previous, year: null }))} />
              {result.facets.years.map((option) => <Choice key={option.value} label={option.label}
                selected={draft.year === Number(option.value)} role="radio" group="Year"
                onPress={() => setDraft((previous) => ({ ...previous, year: Number(option.value) }))} />)}
            </View>
          </View>
          <MultiSelect title="Track quality" options={result.facets.qualities} selected={draft.qualities}
            onToggle={(value) => setDraft((previous) => ({ ...previous, qualities: toggle(previous.qualities, value as JournalCriteria['qualities'][number]) }))} />
          <View style={styles.section}>
            <SectionTitle>Sort</SectionTitle>
            <View style={styles.options}>
              {JOURNAL_SORT_OPTIONS.map((option) => <Choice key={option.value} label={option.label}
                selected={draft.sort === option.value} role="radio" group="Sort"
                onPress={() => setDraft((previous) => ({ ...previous, sort: option.value }))} />)}
            </View>
          </View>
        </ScrollView>
        <View style={styles.footer}>
          <Text accessibilityLiveRegion="polite" style={styles.hint}>
            {result.matchedCount} of {result.totalCount} saved flights match
          </Text>
          <Button label={`Show ${result.matchedCount} ${result.matchedCount === 1 ? 'flight' : 'flights'}`}
            variant="primary" onPress={apply} accessibilityHint="Applies your filters and returns to Home" />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  </Modal>;
}

function SectionTitle({ children }: { children: string }) {
  return <Text accessibilityRole="header" style={styles.sectionTitle}>{children}</Text>;
}

function Choice({ label, selected, role, group, onPress }: {
  label: string; selected: boolean; role: 'checkbox' | 'radio'; group: string; onPress: () => void;
}) {
  return <Pressable accessibilityRole={role} accessibilityLabel={`${group}: ${label}`}
    accessibilityState={{ checked: selected }} onPress={onPress}
    style={({ pressed }) => [styles.choice, selected && styles.choiceSelected, pressed && styles.pressed]}>
    <Text accessible={false} style={[styles.choiceMarker, selected && styles.choiceTextSelected]}>
      {role === 'radio' ? selected ? '●' : '○' : selected ? '✓' : '○'}
    </Text>
    <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text>
  </Pressable>;
}

function MultiSelect({ title, options, selected, onToggle }: {
  title: string; options: JournalFacetOption[]; selected: string[]; onToggle: (value: string) => void;
}) {
  return <View style={styles.section}>
    <SectionTitle>{title}</SectionTitle>
    <View style={styles.options}>
      {options.map((option) => <Choice key={option.value} label={option.label} selected={selected.includes(option.value)}
        role="checkbox" group={title} onPress={() => onToggle(option.value)} />)}
    </View>
    {options.length === 0 ? <Text style={styles.hint}>No options in your saved flights yet.</Text> : null}
  </View>;
}

function SearchableMultiSelect({ title, plural, options, selected, onToggle }: {
  title: string; plural: string; options: JournalFacetOption[]; selected: string[]; onToggle: (value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const selectedValues = useMemo(() => new Set(selected), [selected]);
  const collapsed = options.filter((option, index) => index < COLLAPSED_OPTIONS || selectedValues.has(option.value))
    .slice(0, EXPANDED_PAGE_SIZE);
  const needle = search.trim().toLocaleLowerCase();
  const matching = options.filter((option) => option.label.toLocaleLowerCase().includes(needle));
  const pageCount = Math.max(1, Math.ceil(matching.length / EXPANDED_PAGE_SIZE));
  const activePage = Math.min(page, pageCount - 1);
  const start = activePage * EXPANDED_PAGE_SIZE;
  const shown = expanded ? matching.slice(start, start + EXPANDED_PAGE_SIZE) : collapsed;
  return <View style={styles.section}>
    <SectionTitle>{title}</SectionTitle>
    {selected.length ? <Text style={styles.hint}>{selected.length} selected</Text> : null}
    {expanded ? <Input label={`Search ${plural}`} value={search} onChangeText={(value) => { setSearch(value); setPage(0); }}
      placeholder={`Find ${plural} in your journal`} autoCapitalize="none" last /> : null}
    <View style={styles.options}>
      {shown.map((option) => <Choice key={option.value} label={option.label} selected={selectedValues.has(option.value)}
        role="checkbox" group={title} onPress={() => onToggle(option.value)} />)}
    </View>
    {expanded ? <Text style={styles.hint} accessibilityLiveRegion="polite">
      {`Showing ${matching.length ? start + 1 : 0}–${start + shown.length} of ${matching.length} ${plural}`}
    </Text> : null}
    {expanded && pageCount > 1 ? <View style={styles.pagination}>
      <Button label={`Previous ${plural}`} disabled={activePage === 0} onPress={() => setPage(activePage - 1)} />
      <Button label={`Next ${plural}`} disabled={activePage === pageCount - 1} onPress={() => setPage(activePage + 1)} />
    </View> : null}
    {shown.length === 0 ? <Text style={styles.hint}>{options.length ? `No ${plural} match this search.` : 'No options in your saved flights yet.'}</Text> : null}
    {options.length > COLLAPSED_OPTIONS || expanded ? <Button
      label={expanded ? `Show fewer ${plural}` : `Show all ${plural}`}
      variant="ghost" onPress={() => {
        Keyboard.dismiss(); setSearch(''); setPage(0); setExpanded((previous) => !previous);
      }} /> : null}
  </View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 }, header: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 8, gap: 8 },
  headerActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 },
  title: { fontFamily: fonts.sansBold, fontSize: 26, lineHeight: 32, color: paper.ink },
  content: { paddingHorizontal: 18, paddingVertical: 12, gap: 24 },
  section: { gap: 10 }, sectionTitle: { fontFamily: fonts.monoMedium, fontSize: 12, lineHeight: 18, color: paper.muted, letterSpacing: 1.2 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pagination: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { minHeight: 48, maxWidth: '100%', borderWidth: 1, borderColor: paper.border, backgroundColor: paper.card,
    borderRadius: 16, paddingHorizontal: 13, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', gap: 8 },
  choiceSelected: { backgroundColor: paper.ink, borderColor: paper.ink },
  choiceText: { flexShrink: 1, fontFamily: fonts.sansSemi, fontSize: 14, lineHeight: 21, color: paper.ink },
  choiceMarker: { fontFamily: fonts.sansSemi, fontSize: 15, color: paper.muted },
  choiceTextSelected: { color: paper.onDark }, pressed: { opacity: 0.7 },
  hint: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 18, color: paper.muted },
  footer: { padding: 18, paddingTop: 12, borderTopWidth: 1, borderTopColor: paper.border, gap: 10, backgroundColor: paper.background },
});
