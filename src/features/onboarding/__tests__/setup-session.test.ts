import React from 'react';
import { Modal, View } from 'react-native';
import { Button, Input, LinkButton } from '@/components/ui';
import { FirstRunProvider, useFirstRun } from '../first-run-provider';
import { FirstRunGate } from '../components/first-run-gate';
import { StepChrome } from '../components/step-chrome';
import { act, create } from '../../../../tests/support/renderer';
import { profile } from '../../../../tests/support/fixtures';

let mockSettings: any;
let mockProfile: any;
let mockProfileFailed = false;
let mockSettingsFailed = false;
const mockSaveName = jest.fn();
const mockSaveSettings = jest.fn();
const mockRefetch = jest.fn();
const mockRouter = { replace: jest.fn() };
jest.mock('@/store/endpoints', () => ({
  useGetAppSettingsQuery: () => ({ data: mockSettings, isError: mockSettingsFailed }),
  useGetProfileQuery: () => ({ data: mockProfile, isError: mockProfileFailed, refetch: mockRefetch }),
  useUpdateAppSettingsMutation: () => [mockSaveSettings],
  useUpdateProfileMutation: () => [mockSaveName],
}));
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('nativewind', () => ({ styled: () => 'SafeArea' }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: 'SafeArea' }));
jest.mock('@/components/ui/journal-art', () => ({ JournalArt: () => null }));
jest.mock('@/features/account/auth-provider', () => ({ useCloudAuth: () => ({ status: 'unconfigured' }) }));
jest.mock('../components/permissions-step', () => ({ PermissionsStep: () => null }));

let session: ReturnType<typeof useFirstRun>;
let childMounts = 0;
function Probe() { const value = useFirstRun(); React.useEffect(() => { session = value; }); return null; }
function Navigator() { React.useEffect(() => { childMounts += 1; }, []); return React.createElement(View, { testID: 'navigator' }); }
function App() {
  // eslint-disable-next-line react/no-children-prop -- createElement needs the required children prop in TypeScript.
  return React.createElement(FirstRunProvider, { children: [
    React.createElement(Probe, { key: 'probe' }),
    // eslint-disable-next-line react/no-children-prop -- Required children prop.
    React.createElement(FirstRunGate, { key: 'gate', children: React.createElement(Navigator) }),
  ] });
}
let rendered: ReturnType<typeof create>;
const control = (label: string) => [...rendered.root.findAllByType(Button), ...rendered.root.findAllByType(LinkButton)]
  .find((node: any) => node.props.label === label)!;
async function run(fn: () => unknown) { await act(async () => { await fn(); }); }
async function mount() { await run(() => { rendered = create(React.createElement(App)); }); }
async function press(label: string) { await run(() => control(label).props.onPress()); }
async function nameStep() { await press('I understand'); await press('Start setup'); }
function deferred() { let resolve!: () => void; let reject!: (error: Error) => void; const promise = new Promise<void>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

beforeEach(() => {
  jest.clearAllMocks(); childMounts = 0;
  mockSettings = { onboardingState: 'pending', onboardingCompletedAt: null, disclaimerAckAt: null };
  mockProfile = profile({ pilotName: 'Saved Pilot', gliderType: 'Wing', registrationId: 'ID' });
  mockProfileFailed = false; mockSettingsFailed = false;
  mockSaveName.mockImplementation(() => ({ unwrap: () => Promise.resolve(mockProfile) }));
  mockSaveSettings.mockImplementation(() => ({ unwrap: () => Promise.resolve() }));
});
afterEach(async () => { await run(() => rendered?.unmount()); jest.useRealTimers(); });

it('enforces both real Welcome exits and only opens Home after acknowledgement and completion save', async () => {
  await mount();
  for (const label of ['Start setup', 'Skip setup, open Home']) {
    expect(control(label).props.disabled).toBe(true);
    await press(label); // Invoke even a disabled handler to exercise its guard.
  }
  expect(session.wizard.step).toBe('welcome'); expect(mockSaveSettings).not.toHaveBeenCalled();
  await run(() => session.navigate('skip')); // Provider also owns the guard.
  expect(session.showWizard).toBe(true);
  await press('I understand'); await press('Skip setup, open Home');
  expect(mockSaveSettings).toHaveBeenCalledWith(expect.objectContaining({ onboardingState: 'skipped', disclaimerAckAt: expect.any(Number) }));
  expect(session.showWizard).toBe(false); expect(mockRouter.replace).toHaveBeenCalledWith('/');
});

it('keeps the navigator mounted and hides underlying touch and accessibility during loading and setup', async () => {
  mockSettings = undefined;
  await mount();
  const cover = () => rendered.root.findAllByType(View).find((node: any) => node.props.pointerEvents === 'none');
  expect(cover().props.importantForAccessibility).toBe('no-hide-descendants');
  expect(cover().props.accessibilityElementsHidden).toBe(true);
  mockSettings = { onboardingState: 'pending' };
  await run(() => rendered.update(React.createElement(App)));
  expect(childMounts).toBe(1); expect(cover()).toBeDefined();
  await press('I understand'); await press('Skip setup, open Home');
  expect(childMounts).toBe(1); expect(cover()).toBeUndefined();
});

it('fails open after a stalled settings read without remounting the navigator', async () => {
  jest.useFakeTimers(); mockSettings = undefined;
  await mount(); await run(() => jest.advanceTimersByTime(5000));
  expect(session.status).toBe('unavailable'); expect(session.showWizard).toBe(false); expect(childMounts).toBe(1);
});

it('uses three steps, saves only a trimmed changed name before advancing, and preserves equipment', async () => {
  const save = deferred(); mockSaveName.mockReturnValue({ unwrap: () => save.promise });
  await mount(); await nameStep();
  expect(rendered.root.findByType(StepChrome).props).toMatchObject({ current: 1, total: 3 });
  expect(rendered.root.findAllByType(Input)).toHaveLength(1);
  expect(rendered.root.findByType(Input).props).toMatchObject({ maxLength: 60, value: 'Saved Pilot' });
  await run(() => session.setNameDraft('  New Pilot  '));
  await run(() => { void session.navigate('continue'); void session.navigate('continue'); });
  expect(mockSaveName).toHaveBeenCalledTimes(1); expect(mockSaveName).toHaveBeenCalledWith({ pilotName: 'New Pilot' });
  expect(session.wizard.step).toBe('pilot'); expect(session.saving).toBe('name');
  await run(save.resolve);
  expect(session.wizard.step).toBe('location');
  await run(() => session.navigate('skip'));
  expect(rendered.root.findByType(StepChrome).props).toMatchObject({ current: 3, total: 3 });
  expect(mockProfile.gliderType).toBe('Wing'); expect(mockProfile.registrationId).toBe('ID');
});

it('retains a skipped draft over back navigation and cache refresh, without saving it at completion', async () => {
  await mount(); await nameStep(); await run(() => session.setNameDraft('Unsaved draft'));
  await press('Skip for now');
  mockProfile = profile({ pilotName: 'Refreshed' });
  await run(() => rendered.update(React.createElement(App)));
  await run(() => session.navigate('back'));
  expect(rendered.root.findByType(Input).props.value).toBe('Unsaved draft');
  await press('Skip for now'); await run(() => session.navigate('continue')); await press('Skip — keep it on this phone');
  expect(mockSaveName).not.toHaveBeenCalled(); expect(session.showWizard).toBe(false);
});

it.each(['', '   ', 'Saved Pilot'])('does not erase or rewrite the saved name for %p', async (draft) => {
  await mount(); await nameStep(); await run(() => session.setNameDraft(draft)); await press('Continue');
  expect(mockSaveName).not.toHaveBeenCalled(); expect(session.wizard.step).toBe('location');
});

it('shows field save errors with a preserved draft and supports retry or skip', async () => {
  mockSaveName.mockReturnValueOnce({ unwrap: () => Promise.reject(new Error('disk')) });
  await mount(); await nameStep(); await run(() => session.setNameDraft('Draft')); await press('Continue');
  expect(rendered.root.findByType(Input).props.error).toContain('could not be saved');
  expect(session.nameDraft).toBe('Draft'); expect(session.wizard.step).toBe('pilot');
  await press('Retry'); expect(session.wizard.step).toBe('location'); expect(mockSaveName).toHaveBeenCalledTimes(2);
});

it('keeps completion failure visible; retry persists before closing and prevents duplicate writes', async () => {
  mockSaveSettings.mockReturnValueOnce({ unwrap: () => Promise.reject(new Error('disk')) });
  await mount(); await press('I understand'); await press('Skip setup, open Home');
  expect(session.showWizard).toBe(true); expect(session.completionError).toContain('next launch');
  const save = deferred(); mockSaveSettings.mockReturnValue({ unwrap: () => save.promise });
  await run(() => { void session.retryCompletion(); void session.retryCompletion(); });
  expect(mockSaveSettings).toHaveBeenCalledTimes(2); expect(session.showWizard).toBe(true);
  await run(save.resolve); expect(session.showWizard).toBe(false);
});

it('allows explicit completion without saving and repeats unfinished setup on a full restart with saved name prefilled', async () => {
  mockSaveSettings.mockReturnValue({ unwrap: () => Promise.reject(new Error('disk')) });
  await mount(); await nameStep(); await run(() => session.setNameDraft('Unfinished draft'));
  await run(() => session.navigate('back')); await press('Skip setup, open Home'); await press('Continue without saving');
  expect(session.showWizard).toBe(false);
  await run(() => rendered.unmount()); await mount();
  expect(session.wizard.step).toBe('welcome'); expect(session.nameDraft).toBe('Saved Pilot'); expect(session.showWizard).toBe(true);
});

it('Review preloads saved values, dismisses with Android Back or Close, and preserves completion history', async () => {
  mockSettings = { onboardingState: 'done', onboardingCompletedAt: 100, disclaimerAckAt: 90 };
    await mount(); expect(session.showWizard).toBe(false);
    await run(() => session.restartSetup()); expect(session.mode).toBe('review'); expect(session.nameDraft).toBe('Saved Pilot');
    await run(() => rendered.root.findByType(Modal).props.onRequestClose()); expect(session.showWizard).toBe(false);
    await run(() => session.restartSetup()); await press('Start setup');
    await run(() => session.setNameDraft('Review draft')); await press('Close review');
    await run(() => session.restartSetup()); expect(session.nameDraft).toBe('Saved Pilot');
    await press('Start setup'); await press('Skip for now'); await run(() => session.navigate('skip')); await press('Skip — keep it on this phone');
    expect(session.showWizard).toBe(false); expect(mockSaveSettings).not.toHaveBeenCalled(); expect(mockSaveName).not.toHaveBeenCalled();
    expect(mockSettings).toMatchObject({ onboardingCompletedAt: 100, disclaimerAckAt: 90 });
});
