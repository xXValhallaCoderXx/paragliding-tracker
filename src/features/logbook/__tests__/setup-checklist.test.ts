import type { PilotProfile, RecorderCapabilities } from '@/recorder/types';

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

describe('setupChecklist', () => {
  it('counts nothing done on a fresh install', () => {
    const checklist = setupChecklist({ profile: profile(), capabilities: capabilities() })!;
    expect(checklist.progressLabel).toBe('0 OF 3 DONE');
    expect(checklist.title).toBe('Three things before you fly');
    expect(checklist.items.map((item) => item.done)).toEqual([false, false, false]);
  });

  it('matches the design at one of three done', () => {
    const checklist = setupChecklist({
      profile: profile(),
      capabilities: capabilities(GRANTED),
    })!;
    expect(checklist.progressLabel).toBe('1 OF 3 DONE');
    expect(checklist.title).toBe('Two things before you fly');
    expect(checklist.items[0]).toMatchObject({ key: 'location', label: 'Location allowed', done: true });
  });

  it('says "One thing" rather than "1 things"', () => {
    const checklist = setupChecklist({
      profile: profile({ pilotName: 'Renate', gliderType: 'Ozone Rush 6' }),
      capabilities: capabilities(),
    })!;
    expect(checklist.title).toBe('One thing before you fly');
  });

  it('disappears entirely once everything is done', () => {
    expect(
      setupChecklist({
        profile: profile({ pilotName: 'Renate', gliderType: 'Ozone Rush 6' }),
        capabilities: capabilities(GRANTED),
      }),
    ).toBeNull();
  });

  it('does not count foreground-only permission as done', () => {
    // "While using the app" still stops the track the moment the screen locks, and the
    // pilot would only find out after landing. That is not a completed step.
    const checklist = setupChecklist({
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
    const outstanding = setupChecklist({ profile: profile(), capabilities: capabilities() })!;
    expect(outstanding.items[1]!.detail).toBe('IGC files say UNSPECIFIED until you do');
    expect(outstanding.items[2]!.detail).toBe('Pre-fills every flight you save');

    const partly = setupChecklist({
      profile: profile({ pilotName: 'Renate' }),
      capabilities: capabilities(),
    })!;
    expect(partly.items[1]).toMatchObject({ label: 'Pilot name added', detail: '' });
  });

  it('ignores the glider registration and home site, which setup never asks for', () => {
    // Only the three the design draws. Adding more would turn a nudge into a chore list.
    const checklist = setupChecklist({
      profile: profile({ pilotName: 'Renate', gliderType: 'Rush 6', registrationId: null }),
      capabilities: capabilities(GRANTED),
    });
    expect(checklist).toBeNull();
  });
});
