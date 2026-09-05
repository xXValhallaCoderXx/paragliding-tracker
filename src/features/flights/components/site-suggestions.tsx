import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { skipToken } from '@reduxjs/toolkit/query';

import { LinkButton } from '@/components/ui';
import { sitePickerView } from '@/features/flights/site-picker';
import type { SitePickerTrigger } from '@/features/flights/site-picker';
import { formatDistance } from '@/lib/format/flight-format';
import { attributionFor, roundNear, SITE_SUGGESTION_LIMIT } from '@/sites/site-plan';
import type { Coordinate, SiteSuggestion } from '@/sites/types';
import { useNearbySitesQuery, useSearchSitesQuery } from '@/store/endpoints';
import { fonts, paper } from '@/ui/theme';

/**
 * The launch picker under the Site field.
 *
 * A panel that opens when the pilot asks for it and closes when they have what they came
 * for — see `site-picker.ts` for why that had to become explicit state. Two sources feed one
 * list: launches near where this flight actually took off, and places matching whatever is
 * typed. Both are offers; the field underneath stays a plain text box, and an empty list is
 * a normal answer rather than an error.
 */
export function SiteSuggestions({
  query,
  near,
  trigger,
  locating,
  disabled = false,
  onOpen,
  onDismiss,
  onLocate,
  onSelect,
}: {
  /** Whatever is currently in the Site field. */
  query: string;
  /**
   * Where to look, when that is known: the flight's own launch fix, or a live read. Owned by
   * the form rather than here, so the field's hint and this panel can never disagree about
   * whether there is anywhere to look.
   */
  near: Coordinate | null;
  /** What the pilot last did. `none` covers both "has not touched it" and "is done". */
  trigger: SitePickerTrigger;
  locating: boolean;
  disabled?: boolean;
  onOpen: () => void;
  onDismiss: () => void;
  onLocate: () => void;
  onSelect: (site: SiteSuggestion) => void;
}) {
  // Debounced in state rather than a ref: React Compiler rejects ref reads during render,
  // and a state value written by a timer keeps render a pure function of state — the same
  // shape the account screen uses for its ticking clock.
  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 350);
    return () => clearTimeout(timer);
  }, [query]);

  // Rounded before it becomes part of a cache key: RTK Query keys on the stringified
  // argument, so a jittering coordinate would defeat the cache entirely.
  const roundedNear = near ? roundNear(near) : null;

  // Built twice: once to learn whether a request is even wanted, then again with what came
  // back. The first pass is what keeps a closed panel from putting a search on the wire —
  // which is exactly what used to happen on opening an already-named flight.
  const intent = sitePickerView({
    query,
    debouncedQuery: debounced,
    trigger,
    hasPosition: near !== null,
    resultCount: 0,
    fetching: false,
  });

  const { data: nearby = EMPTY, isFetching: loadingNearby } = useNearbySitesQuery(
    intent.shouldLookNearby && roundedNear ? roundedNear : skipToken,
  );
  const { data: matches = EMPTY, isFetching: searching } = useSearchSitesQuery(
    intent.shouldSearch ? { query: debounced.trim(), near: roundedNear } : skipToken,
  );

  const results = (intent.mode === 'search' ? matches : nearby).slice(0, SITE_SUGGESTION_LIMIT);
  const view = sitePickerView({
    query,
    debouncedQuery: debounced,
    trigger,
    hasPosition: near !== null,
    resultCount: results.length,
    fetching: intent.mode === 'search' ? searching : loadingNearby,
  });

  if (!view.open) {
    return (
      <View style={[styles.group, styles.closedGroup]}>
        {view.reopen === 'nearby' ? (
          <LinkButton label="Nearby launches" disabled={disabled} onPress={onOpen} />
        ) : (
          <LinkButton
            label={locating ? 'Finding you…' : 'Use my current location'}
            disabled={disabled || locating}
            onPress={onLocate}
          />
        )}
      </View>
    );
  }

  const attribution = attributionFor(results);

  return (
    <View style={styles.group}>
      <View style={styles.panel}>
        <View style={styles.header}>
          <Text style={styles.title}>{view.title.toUpperCase()}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close launch suggestions"
            accessibilityState={{ disabled }}
            disabled={disabled}
            hitSlop={10}
            onPress={onDismiss}
            style={({ pressed }) => pressed && styles.pressed}>
            <Text style={styles.close}>✕</Text>
          </Pressable>
        </View>

        {results.map((site, index) => (
          <SiteRow
            key={site.id}
            site={site}
            first={index === 0}
            disabled={disabled}
            onPress={() => onSelect(site)}
          />
        ))}

        {view.busy ? (
          <View style={styles.message}>
            <ActivityIndicator size="small" color={paper.muted} />
            <Text style={styles.messageText}>Looking for launches…</Text>
          </View>
        ) : view.empty ? (
          <View style={styles.message}>
            <Text style={styles.messageText}>{view.empty}</Text>
          </View>
        ) : null}

        {attribution ? (
          // Both licences require credit where the data is shown, and they are different
          // licences — so this names only the sources actually in the list.
          <Text style={styles.attribution}>{attribution}</Text>
        ) : null}
      </View>
    </View>
  );
}

/** Stable identity, so a default `[]` does not invalidate the memos downstream. */
const EMPTY: SiteSuggestion[] = [];

/**
 * One selectable launch.
 *
 * Deliberately not `ListRow`: that renders its `action` as a `LinkButton`, so a row-level
 * press on top of it would create two overlapping tap targets and an ambiguous
 * accessibility tree.
 */
function SiteRow({
  site,
  first,
  disabled,
  onPress,
}: {
  site: SiteSuggestion;
  first: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const detail = [
    site.distanceMetres === null ? null : formatDistance(site.distanceMetres),
    site.detail,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={detail ? `${site.name}, ${detail}` : site.name}
      accessibilityHint="Sets this flight's site"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, !first && styles.divided, pressed && styles.rowPressed]}>
      <View style={styles.rowText}>
        <Text style={styles.name} numberOfLines={1}>
          {site.name}
        </Text>
        {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The field and its picker are one control, so the divider that separates them from the
  // next field belongs at the bottom of both. Drawn here rather than by the Input above,
  // which is passed `last` — otherwise the panel appears below the Site field's own rule and
  // reads as belonging to Notes.
  group: {
    paddingTop: 2,
    paddingBottom: 11,
    alignItems: 'stretch',
    borderBottomWidth: 1,
    borderBottomColor: paper.hairline,
  },
  // Inset rather than raised. This panel opens *inside* a Card, and a Card is already the
  // lightest surface in the palette — a raised panel on top of it would differ from its own
  // background by a hairline and read as more form. Same treatment as EvidenceBlock.
  // Left-aligned so the link is a link and not a full-width tap target.
  closedGroup: { alignItems: 'flex-start' },
  panel: {
    marginTop: 2,
    backgroundColor: paper.cardAlt,
    borderWidth: 1,
    borderColor: paper.border,
    borderRadius: 12,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 9,
    paddingBottom: 7,
    borderBottomWidth: 1,
    borderBottomColor: paper.border,
  },
  title: { fontFamily: fonts.sansSemi, fontSize: 9.5, letterSpacing: 1.3, color: paper.muted },
  close: { fontFamily: fonts.sans, fontSize: 13, color: paper.muted, paddingHorizontal: 2 },
  pressed: { opacity: 0.55 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  divided: { borderTopWidth: 1, borderTopColor: paper.border },
  rowPressed: { backgroundColor: paper.border },
  rowText: { flex: 1, gap: 2 },
  name: { fontFamily: fonts.sansMedium, fontSize: 13.5, color: paper.ink },
  detail: { fontFamily: fonts.sans, fontSize: 11, color: paper.muted },
  chevron: { fontFamily: fonts.sans, fontSize: 17, color: paper.faint },
  message: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 13,
  },
  messageText: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16, color: paper.muted, flex: 1 },
  attribution: {
    fontFamily: fonts.sans,
    fontSize: 10,
    lineHeight: 14,
    color: paper.ghost,
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 9,
    borderTopWidth: 1,
    borderTopColor: paper.border,
  },
});
