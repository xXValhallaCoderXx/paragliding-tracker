export interface GapStatistics {
  sampleCount: number;
  gapCount: number;
  medianGapMs: number | null;
  p95GapMs: number | null;
  maxGapMs: number | null;
  gapsOver15Seconds: number;
}

export function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const index = Math.max(0, Math.ceil(fraction * sorted.length) - 1);
  return sorted[index] ?? null;
}

export function calculateGapStatistics(timestamps: number[]): GapStatistics {
  const ordered = timestamps.filter(Number.isFinite).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const gap = ordered[index]! - ordered[index - 1]!;
    if (gap >= 0) gaps.push(gap);
  }

  return {
    sampleCount: ordered.length,
    gapCount: gaps.length,
    medianGapMs: percentile(gaps, 0.5),
    p95GapMs: percentile(gaps, 0.95),
    maxGapMs: gaps.length > 0 ? Math.max(...gaps) : null,
    gapsOver15Seconds: gaps.filter((gap) => gap > 15_000).length,
  };
}

export function calculateAccuracyStatistics(accuracies: (number | null)[]) {
  const values = accuracies.filter(
    (value): value is number => value !== null && Number.isFinite(value) && value >= 0,
  );
  return {
    sampleCount: values.length,
    medianMetres: percentile(values, 0.5),
    p95Metres: percentile(values, 0.95),
    maxMetres: values.length > 0 ? Math.max(...values) : null,
  };
}
