/**
 * Which recorded fixes are worth drawing.
 *
 * Promoted out of `flight-metrics.ts`, where it was module-private, so the plate and the
 * metrics agree on what counts as a fix by construction rather than by two developers
 * remembering the same list. The types are structural on purpose — `src/lib` is a leaf and
 * must not import `@/recorder/types`.
 *
 * Not `selectExportEligibleFixes`: that one additionally requires a valid `gpsAltitude` and
 * dedupes to one fix per second, which is right for IGC and wrong here. A fix with a good
 * position and no altitude is perfectly drawable, and dropping it would make the plate
 * disagree with the fix count shown beside it.
 */

export interface UsableFix {
  latitude: number;
  longitude: number;
  sourceTimestamp: number;
  sequence: number;
  mocked: boolean;
}

/** The span a fix has to fall inside. `endedAt` is null while a session is still open. */
export interface FixWindow {
  startedAt: number;
  endedAt: number | null;
}

export function isUsableCoordinateFix(fix: UsableFix): boolean {
  return (
    Number.isFinite(fix.sourceTimestamp) &&
    Number.isFinite(fix.sequence) &&
    Number.isFinite(fix.latitude) &&
    fix.latitude >= -90 &&
    fix.latitude <= 90 &&
    Number.isFinite(fix.longitude) &&
    fix.longitude >= -180 &&
    fix.longitude <= 180 &&
    !fix.mocked
  );
}

/**
 * Usable fixes inside the window, in recorded order.
 *
 * Sorted by source timestamp then sequence: batches arrive out of order often enough that
 * drawing them as delivered produces a track that jumps backwards.
 */
export function orderedUsableFixes<T extends UsableFix>(
  fixes: readonly T[],
  window: FixWindow,
): T[] {
  return fixes
    .filter(
      (fix) =>
        isUsableCoordinateFix(fix) &&
        fix.sourceTimestamp >= window.startedAt &&
        (window.endedAt === null || fix.sourceTimestamp <= window.endedAt),
    )
    .sort(
      (left, right) =>
        left.sourceTimestamp - right.sourceTimestamp || left.sequence - right.sequence,
    );
}
