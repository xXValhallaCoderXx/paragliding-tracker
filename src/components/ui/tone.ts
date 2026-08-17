import { paper, type Tone } from '@/ui/theme';

/**
 * Tone as a runtime colour string. Needed where a colour is a *prop* rather than a style —
 * `PulseDot` animates opacity through the legacy Animated API and composes a box-shadow from
 * this value, so it cannot be a class name.
 */
export function toneColor(tone: Tone): string {
  switch (tone) {
    case 'good':
      return paper.good;
    case 'warning':
      return paper.warn;
    case 'danger':
      return paper.danger;
    default:
      return paper.faint;
  }
}
