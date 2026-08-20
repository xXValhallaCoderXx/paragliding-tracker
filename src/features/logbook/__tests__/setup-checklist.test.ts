import type { AppSettings, PilotProfile, RecorderCapabilities } from '@/recorder/types';

import { setupChecklist } from '../setup-checklist';

function profile(overrides: Partial<PilotProfile> = {}): PilotProfile {
  return {
    pilotName: null,
    gliderType: null,
    gliderId: null,
    registrationId: null,
    updatedAt: 0,
    pushedUpdatedAt: null,
    ...overrides,
  };
}

function capabilities(overrides: Partial<RecorderCapabilities> = {}): RecorderCapabilities {
  return {
    platform: 'android',
    supported: true,
    taskManagerAvailable: true,
    locationServicesEnabled: true,
    gpsAvailable: true,
    preciseLocation: true,
    pressureAvailable: true,
    batteryAvailable: true,
    sharingAvailable: true,
    foregroundPermission: 'unknown',
    backgroundPermission: 'unknown',
    ...overrides,
  };
}

const GRANTED = { foregroundPermission: 'granted', backgroundPermission: 'granted' } as const;

/**
 * Defaults to the only state that offers the card at all, so the cases below stay about what the
 * card says rather than repeating why it is on screen. The gate itself is tested separately.
 */
function build(args: {
  profile: PilotProfile;
  capabilities: RecorderCapabilities;
  onboardingState?: AppSettings['onboardingState'] | null;
}) {
  return setupChecklist({ onboardingState: 'skipped', ...args });
}

describe('setupChecklist', () => {
  it('counts nothing done on a fresh install', () => {
    const checklist = build({ profile: profile(), capabilities: capabilities() })!;
    expect(checklist.progressLabel).toBe('0 OF 3 DONE');
    expect(checklist.title).toBe('Three things before you fly');
    expect(checklist.items.map((item) => item.done)).toEqual([false, false, false]);
  });

  it('matches the design at one of three done', () => {
    const checklist = build({
      profile: profile(),
      capabilities: capabilities(GRANTED),
    })!;
    expect(checklist.progressLabel).toBe('1 OF 3 DONE');
    expect(checklist.title).toBe('Two things before you fly');
    expect(checklist.items[0]).toMatchObject({ key: 'location', label: 'Location allowed', done: true });
  });

  it('says "One thing" rather than "1 things"', () => {
    const checklist = build({
      profile: profile({ pilotName: 'Renate', gliderType: 'Ozone Rush 6' }),
      capabilities: capabilities(),
    })!;
    expect(checklist.title).toBe('One thing before you fly');
  });

  it('disappears entirely once everything is done', () => {
    expect(
      build({
        profile: profile({ pilotName: 'Renate', gliderType: 'Ozone Rush 6' }),
        capabilities: capabilities(GRANTED),
      }),
    ).toBeNull();
  });

  it('does not count foreground-only permission as done', () => {
    // "While using the app" still stops the track the moment the screen locks, and the
    // pilot would only find out after landing. That is not a completed step.
    const checklist = build({
      profile: profile(),
      capabilities: capabilities({
        foregroundPermission: 'granted',
        backgroundPermission: 'denied',
      }),
    })!;
    expect(checklist.items[0]!.done).toBe(false);
    expect(checklist.progressLabel).toBe('0 OF 3 DONE');
  });

  it('explains why each outstanding item matters, and stops once it is done', () => {
    const outstanding = build({ profile: profile(), capabilities: capabilities() })!;
    expect(outstanding.items[1]!.detail).toBe('IGC files say UNSPECIFIED until you do');
    expect(outstanding.items[2]!.detail).toBe('Pre-fills every flight you save');

    const partly = build({
      profile: profile({ pilotName: 'Renate' }),
      capabilities: capabilities(),
    })!;
    expect(partly.items[1]).toMatchObject({ label: 'Pilot name added', detail: '' });
  });

  it('ignores the glider registration and home site, which setup never asks for', () => {
    // Only the three the design draws. Adding more would turn a nudge into a chore list.
    const checklist = build({
      profile: profile({ pilotName: 'Renate', gliderType: 'Rush 6', registrationId: null }),
      capabilities: capabilities(GRANTED),
    });
    expect(checklist).toBeNull();
  });
});

describe('who is offered the checklist at all', () => {
  const bare = { profile: profile(), capabilities: capabilities() };

  it('offers it to a pilot who skipped setup', () => {
    expect(build({ ...bare, onboardingState: 'skipped' })).not.toBeNull();
  });

  it('never offers it to a pilot who stepped through setup', () => {
    // They were asked about every one of these and answered. Asking again reads as the app
    // not having listened — which is exactly how it looked when the gate was missing and a
    // completed wizard still produced a card saying "add your pilot name".
    expect(build({ ...bare, onboardingState: 'done' })).toBeNull();
  });

  it('stays quiet while setup has not happened yet, because the wizard is on screen', () => {
    expect(build({ ...bare, onboardingState: 'pending' })).toBeNull();
  });

  it('stays quiet while the settings read is still in flight', () => {
    // A card that flashes on and then disappears a moment later is worse than one that
    // arrives late.
    expect(build({ ...bare, onboardingState: null })).toBeNull();
  });
});
