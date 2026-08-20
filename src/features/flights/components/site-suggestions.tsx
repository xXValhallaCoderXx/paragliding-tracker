import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { skipToken } from '@reduxjs/toolkit/query';

import { Disclaimer, LinkButton } from '@/components/ui';
import { readCoarsePosition } from '@/features/flights/current-position';
import { formatDistance } from '@/lib/format/flight-format';
import {
  attributionFor,
  isSearchable,
  roundNear,
  SITE_SUGGESTION_LIMIT,
} from '@/sites/site-plan';
import type { Coordinate, SiteSuggestion } from '@/sites/types';
import { useNearbySitesQuery, useSearchSitesQuery } from '@/store/endpoints';
import { fonts, paper } from '@/ui/theme';

/**
 * Launch suggestions under the Site field.
 *
 * Two sources, one list: nearby launches from where the flight actually took off, and
 * places matching whatever the pilot types. Both are offers — the field underneath stays
 * a plain text box, and an empty list is a normal state rather than an error, because
 * outside Europe the catalogues are genuinely thin.
 */
export function SiteSuggestions({
  query,
  takeoff,
  disabled = false,
  onSelect,
}: {
  /** Whatever is currently in the Site field. */
  query: string;
  /** Where the flight launched, when it is known. */
  takeoff: Coordinate | null;
  disabled?: boolean;
  onSelect: (site: SiteSuggestion) => void;
}) {
  // A live read is offered only when the flight has no takeoff fix of its own — anything
  // recorded before this existed, or a flight whose fixes were all ineligible.
  const [livePosition, setLivePosition] = useState<Coordinate | null>(null);
  const [locating, setLocating] = useState(false);
  const near = takeoff ?? livePosition;

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

  const { data: nearby = EMPTY, isFetching: loadingNearby } = useNearbySitesQuery(
    roundedNear ?? skipToken,
  );
  const { data: matches = EMPTY, isFetching: searching } = useSearchSitesQuery(
    isSearchable(debounced) ? { query: debounced.trim(), near: roundedNear } : skipToken,
  );

  const typing = isSearchable(debounced);
  const shown = (typing ? matches : nearby).slice(0, SITE_SUGGESTION_LIMIT);
  const busy = typing ? searching : loadingNearby;
  const attribution = attributionFor(shown);

  const locate = async () => {
    setLocating(true);
    try {
      setLivePosition(await readCoarsePosition());
    } finally {
      setLocating(false);
    }
  };

  return (
    <View style={styles.wrap}>
      {shown.length > 0 ? (
        <View style={styles.list}>
          {shown.map((site) => (
            <SiteRow key={site.id} site={site} disabled={disabled} onPress={() => onSelect(site)} />
          ))}
        </View>
      ) : null}

      {busy ? (
        <View style={styles.busyRow}>
          <ActivityIndicator size="small" color={paper.muted} />
          <Text style={styles.busyLabel}>Looking for launches…</Text>
        </View>
      ) : null}

      {!near && !typing ? (
        <View style={styles.locateRow}>
          <LinkButton
            label={locating ? 'Finding you…' : 'Use my current location'}
            onPress={() => void locate()}
          />
          <Text style={styles.hint}>
            This flight has no recorded launch position, so nearby launches need a location fix.
          </Text>
        </View>
      ) : null}

      {attribution ? (
        // Both licences require credit where the data is shown, and they are different
        // licences — so this names only the sources actually in the list.
        <Disclaimer align="left">{attribution}</Disclaimer>
      ) : null}
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
  disabled,
  onPress,
}: {
  site: SiteSuggestion;
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
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <Text style={styles.name} numberOfLines={1}>
        {site.name}
      </Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingBottom: 10, gap: 8 },
  list: { gap: 2 },
  row: { minHeight: 40, justifyContent: 'center', paddingVertical: 6, gap: 1 },
  rowPressed: { opacity: 0.6 },
  name: { fontFamily: fonts.sansMedium, fontSize: 13, color: paper.ink },
  detail: { fontFamily: fonts.sans, fontSize: 11, color: paper.muted },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  busyLabel: { fontFamily: fonts.sans, fontSize: 11.5, color: paper.muted },
  locateRow: { gap: 2, paddingTop: 2 },
  hint: { fontFamily: fonts.sans, fontSize: 11, lineHeight: 15.5, color: paper.muted },
});
