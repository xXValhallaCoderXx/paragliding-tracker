import type { CloudAuthStatus } from '@/cloud/types';
import { flightHeadline, formatLongDate } from '@/lib/format/flight-format';
import type { FlightSummary } from '@/recorder/types';

import { savedFlights, type LogbookLayout } from './logbook';

/**
 * How many flights this phone keeps without an account.
 *
 * The cap is enforced by consent, never by the code: recording is never blocked, saving
 * is never blocked, and nothing is ever deleted for the pilot. Going over is a state they
 * can sit in indefinitely until they choose a way out. A recorder that refused to record
 * because a logbook was full would be a worse product and would fail App Store 5.1.1(v).
 *
 * Every decision lives here rather than in the screen because jest's testMatch only picks
 * up `.ts` — a rule in a `.tsx` is a rule nothing checks.
 */
export const GUEST_FLIGHT_CAPACITY = 10;

/** 8 and 9 warn ahead of time. Below that the pilot hears nothing about it. */
export const GUEST_CAPACITY_WARN_FROM = 8;

/**
 * Why the cap does not apply.
 *
 * A reason rather than a boolean so `restoring` can never be mistaken for `signed_out`,
 * and so the logbook and the account screen cannot disagree about what is being asked.
 */
export type CapExemption =
  /** An account: unlimited. */
  | 'signed_in'
  /** This phone has had an account. Signing out is not a capacity cliff. */
  | 'linked'
  /** Auth is still reading the stored session. Never accuse a pilot on a cold start. */
  | 'unknown'
  /** No cloud in this build, so there is no account to offer. */
  | 'unavailable';

export type GuestCapacityLevel = 'exempt' | 'clear' | 'near' | 'full' | 'over';

export interface GuestCapacity {
  level: GuestCapacityLevel;
  /** Non-null only when `level` is `exempt`. */
  exemption: CapExemption | null;
  saved: number;
  limit: number;
  /** `max(0, limit - saved)` */
  remaining: number;
  /** `max(0, saved - limit)`; only ever above zero at level `over`. */
  over: number;
}

export interface GuestCapacityInput {
  savedFlights: number;
  /** Verbatim `auth.status` from `useCloudAuth()`. */
  authStatus: CloudAuthStatus;
  /** `cloud_link.user_id`. Non-null means this device has been bound to an account. */
  linkedUserId: string | null;
  limit?: number;
  warnFrom?: number;
}

function exemptionFor(input: GuestCapacityInput): CapExemption | null {
  // Ordered most-fundamental-cause-first, the same way evaluateSyncGate reads.
  if (input.authStatus === 'unsupported' || input.authStatus === 'unconfigured') {
    return 'unavailable';
  }
  if (input.authStatus === 'restoring') return 'unknown';
  if (input.authStatus === 'signed_in') return 'signed_in';
  if (input.linkedUserId !== null) return 'linked';
  return null;
}

export function evaluateGuestCapacity(input: GuestCapacityInput): GuestCapacity {
  const limit = input.limit ?? GUEST_FLIGHT_CAPACITY;
  const warnFrom = input.warnFrom ?? GUEST_CAPACITY_WARN_FROM;
  if (limit < 1) {
    // A config typo here would put every pilot permanently over the line with no way
    // back. Fail loudly in a test rather than quietly on a phone.
    throw new Error(`Guest flight capacity must be at least 1, got ${limit}`);
  }

  const saved = Math.max(0, input.savedFlights);
  const remaining = Math.max(0, limit - saved);
  const over = Math.max(0, saved - limit);

  const exemption = exemptionFor(input);
  if (exemption) return { level: 'exempt', exemption, saved, limit, remaining, over };

  const level: GuestCapacityLevel =
    saved > limit ? 'over' : saved === limit ? 'full' : saved >= warnFrom ? 'near' : 'clear';

  return { level, exemption: null, saved, limit, remaining, over };
}

/** Counts the cards the logbook renders, not the rows the repository returns. */
export function countSavedFlights(layout: LogbookLayout): number {
  return savedFlights(layout).length;
}

/**
 * Whether `deleteCompletedFlight` will actually accept this flight.
 *
 * Deliberately a different predicate from "counts toward capacity": a `processing`
 * flight is a visible card that consumes a slot, but the repository refuses to delete it.
 * Offering a button that throws, on the screen the pilot went to in order to comply, is
 * the worst version of this feature.
 */
export function isRemovableFlight(flight: FlightSummary): boolean {
  return (
    (flight.status === 'completed' || flight.status === 'partial') &&
    flight.sessionStatus === 'completed'
  );
}

/**
 * The one flight the banner offers to remove: the oldest the repository will accept.
 * Skips anything still processing rather than giving up on the first one it hits.
 */
export function oldestRemovableFlight(layout: LogbookLayout): FlightSummary | null {
  const candidates = savedFlights(layout).filter(isRemovableFlight);
  if (candidates.length === 0) return null;
  return candidates.reduce((oldest, flight) =>
    flight.startedAt < oldest.startedAt ? flight : oldest,
  );
}

export type CapacityNoticeTone = 'warning' | 'danger';

export interface GuestCapacityNotice {
  key: 'near' | 'full' | 'over' | 'over-blocked';
  tone: CapacityNoticeTone;
  title: string;
  body: string;
  /** The way out is never destructive by default, so the primary action is the account. */
  primaryLabel: string;
  /** Null when nothing is removable yet — see `oldestRemovableFlight`. */
  remove: { flightId: string; label: string } | null;
  dismissible: boolean;
}

const NEVER_DELETES = 'Nothing is ever removed for you.';

const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'] as const;

/** Small numbers read better as words in a sentence; larger ones do not. */
function countWord(count: number): string {
  return COUNT_WORDS[count] ?? String(count);
}

export function guestCapacityNotice(
  capacity: GuestCapacity,
  oldestRemovable: FlightSummary | null,
): GuestCapacityNotice | null {
  if (capacity.level === 'exempt' || capacity.level === 'clear') return null;

  const primaryLabel = 'Create a free account';
  const remove = oldestRemovable
    ? { flightId: oldestRemovable.id, label: 'Review oldest flight' }
    : null;

  if (capacity.level === 'near') {
    const slots = capacity.remaining === 1 ? '1 more flight' : `${capacity.remaining} more flights`;
    return {
      key: 'near',
      tone: 'warning',
      title: `Room for ${slots} on this phone`,
      body: `Without an account this phone keeps ${capacity.limit} flights. A free account keeps every flight, with its stats and its IGC file. ${NEVER_DELETES}`,
      primaryLabel,
      remove,
      dismissible: true,
    };
  }

  if (capacity.level === 'full') {
    return {
      key: 'full',
      tone: 'warning',
      title: `This phone's logbook is full`,
      body: `You have ${capacity.saved} of ${capacity.limit} flights. Your next flight will still record and save — it just puts you over. A free account keeps every flight. ${NEVER_DELETES}`,
      primaryLabel,
      remove,
      dismissible: true,
    };
  }

  const excess = capacity.over === 1 ? '1 flight' : `${capacity.over} flights`;
  if (!remove) {
    // Over the line, but every candidate is still processing. Say so plainly instead of
    // rendering a button that would throw.
    return {
      key: 'over-blocked',
      tone: 'danger',
      title: `${excess} over this phone's limit`,
      body: `You have ${capacity.saved} flights and no account. Stats are still finishing on the older ones, so there is nothing to remove yet. A free account keeps every flight. ${NEVER_DELETES}`,
      primaryLabel,
      remove: null,
      dismissible: false,
    };
  }

  return {
    key: 'over',
    tone: 'danger',
    title: `${excess} over this phone's limit`,
    body: `You have ${capacity.saved} flights and no account, which keeps ${capacity.limit}. Recording still works and ${NEVER_DELETES.toLowerCase()} Create a free account to keep them all, or remove one yourself.`,
    primaryLabel,
    remove,
    dismissible: false,
  };
}

export interface BackupSummary {
  headline: string;
  /** "6 / 10", or null when there is no cap to show. */
  value: string | null;
  detail: string;
  /** Null when there is nothing to offer — signed in already, or no cloud in this build. */
  ctaLabel: string | null;
  meter: { value: number; max: number; tone: 'neutral' | 'warning' | 'danger' } | null;
}

/**
 * The Account screen's backup section.
 *
 * Says the same thing as the logbook banner in fewer words, and never contradicts it —
 * both read from the same `GuestCapacity`, so "four more" here and "room for 4 flights"
 * there cannot drift apart.
 */
export function backupSummary(capacity: GuestCapacity): BackupSummary {
  if (capacity.level === 'exempt') {
    const exempt = capacity.exemption;
    if (exempt === 'signed_in') {
      return {
        headline: 'Backed up',
        value: null,
        detail: 'Every flight is copied to your account with its stats and its IGC file.',
        ctaLabel: null,
        meter: null,
      };
    }
    if (exempt === 'unavailable') {
      return {
        headline: 'Kept on this phone only',
        value: null,
        detail: 'Backup needs this app to be built with a cloud project configured.',
        ctaLabel: null,
        meter: null,
      };
    }
    return {
      headline: 'Kept on this phone only',
      value: null,
      detail: 'Sign back in and this phone picks up where it left off.',
      ctaLabel: 'Back up for free',
      meter: null,
    };
  }

  const tone =
    capacity.level === 'over' ? 'danger' : capacity.level === 'clear' ? 'neutral' : 'warning';
  const remaining =
    capacity.remaining === 1 ? 'One more' : `${countWord(capacity.remaining)} more`;
  const detail =
    capacity.level === 'over'
      ? `You are ${capacity.over} over. ${NEVER_DELETES} Create a free account to keep them all, or remove one yourself.`
      : capacity.remaining === 0
        ? `Your next flight puts you over. ${NEVER_DELETES}`
        : `${remaining} before the logbook asks you to sign in or remove one. ${NEVER_DELETES}`;

  return {
    headline: 'Kept on this phone only',
    value: `${capacity.saved} / ${capacity.limit}`,
    detail,
    ctaLabel: 'Back up for free',
    meter: { value: capacity.saved, max: capacity.limit, tone },
  };
}

export interface RemovalGuidance {
  title: string;
  body: string;
}

/**
 * The line shown on the flight detail screen when the pilot arrived there from the
 * capacity banner. It has to name the flight, because "the oldest flight" is not
 * something anyone remembers.
 */
export function removalGuidance(flight: FlightSummary): RemovalGuidance {
  const date = formatLongDate(flight.startedAt, flight.timezoneOffsetMinutes);
  return {
    title: 'Making room in your logbook',
    body: `${flightHeadline(flight)} · ${date}. Share the IGC below if you want to keep this flight's track, then delete it. Or create a free account and keep every flight instead.`,
  };
}
