import React from 'react';
import { AppState } from 'react-native';
import { Button, Input, LinkButton } from '@/components/ui';
import { SignInCard } from '../components/sign-in-card';
import { act, create } from '../../../../tests/support/renderer';

jest.mock('@/components/ui/journal-art', () => ({ JournalArt: () => null }));
jest.mock('@/components/ui', () => Object.fromEntries([
  'Button', 'Card', 'Disclaimer', 'Input', 'LinkButton', 'ListRow', 'Notice',
].map(name => [name, ({ children }: { children?: React.ReactNode }) => children ?? null])));
const send = jest.fn();
const verify = jest.fn();
let rendered: ReturnType<typeof create>;
const form = () => React.createElement(SignInCard, { requestOtp: send, verifyOtp: verify });
const input = () => rendered.root.findByType(Input);
const control = (label: string) => [...rendered.root.findAllByType(Button), ...rendered.root.findAllByType(LinkButton)]
  .find((node: any) => node.props.label === label)!;
async function run(fn: () => unknown) { await act(async () => { await fn(); }); }
async function mount() { await run(() => { rendered = create(form()); }); }
async function press(label: string) { await run(() => control(label).props.onPress()); }
async function codeStep() {
  await run(() => input().props.onChangeText(' Pilot@Example.test '));
  await press('Email me a code');
}
function deferred() {
  let resolve!: () => void; let reject!: (error: Error) => void;
  const promise = new Promise<void>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  jest.useFakeTimers(); jest.setSystemTime(1000);
  send.mockReset().mockResolvedValue(undefined); verify.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => { await run(() => rendered?.unmount()); jest.useRealTimers(); });

it('normalizes formatted paste before eight digits, and only verifies on Continue', async () => {
  await mount();
  expect(control('Email me a code').props.disabled).toBe(true);
  await press('Email me a code'); expect(send).not.toHaveBeenCalled();
  await codeStep(); expect(send).toHaveBeenCalledWith('pilot@example.test');
  expect(input().props.maxLength).toBeUndefined();
  await run(() => input().props.onChangeText('1234 5678\n9'));
  expect(input().props.value).toBe('12345678'); expect(verify).not.toHaveBeenCalled();
  await press('Continue'); expect(verify).toHaveBeenCalledWith('pilot@example.test', '12345678');
});

it('guards duplicate send, verify, resend and email-change handlers immediately', async () => {
  const pending = deferred(); send.mockReturnValue(pending.promise);
  await mount(); await run(() => input().props.onChangeText('pilot@example.test'));
  const sendButton = control('Email me a code');
  await run(() => { sendButton.props.onPress(); sendButton.props.onPress(); input().props.onSubmitEditing(); });
  expect(send).toHaveBeenCalledTimes(1); expect(input().props.editable).toBe(false);
  await run(pending.resolve); await run(() => input().props.onChangeText('12345678'));
  await run(() => jest.advanceTimersByTime(60_000));
  const checking = deferred(); verify.mockReturnValue(checking.promise);
  const continueButton = control('Continue'); const changeEmail = control('Use a different email'); const resend = control('Send a new code');
  await run(() => { continueButton.props.onPress(); continueButton.props.onPress(); changeEmail.props.onPress(); resend.props.onPress(); });
  expect(verify).toHaveBeenCalledTimes(1); expect(send).toHaveBeenCalledTimes(1);
  expect(input().props.label).toBe('Your code'); expect(control('Use a different email').props.disabled).toBe(true);
  await run(checking.resolve);
});

it('uses wall-clock resend timing, refuses early resend, and clears obsolete code after successful resend', async () => {
  await mount(); await codeStep(); await run(() => input().props.onChangeText('12345678'));
  expect(input().props.hint).toBe('Code expires in 60:00');
  await press('Resend code in 60 s'); expect(send).toHaveBeenCalledTimes(1);
  await run(() => jest.advanceTimersByTime(59_000)); expect(control('Resend code in 1 s').props.disabled).toBe(true);
  await run(() => jest.advanceTimersByTime(1000)); await press('Send a new code');
  expect(send).toHaveBeenCalledTimes(2); expect(input().props.value).toBe('');
  expect(control('Resend code in 60 s').props.disabled).toBe(true);
  await run(() => jest.advanceTimersByTime(3_600_000)); expect(input().props.hint).toContain('expired');
});

it.each(['Could not reach the account service. Try again shortly.', 'That code is not right. Check the email and try again.', 'That code has expired. Send a new one.', 'Too many codes requested. Wait a minute and try again.'])(
  'keeps the editable code after %s and permits explicit retry', async (message) => {
    verify.mockRejectedValueOnce(new Error(message));
    await mount(); await codeStep(); await run(() => input().props.onChangeText('12345678')); await press('Continue');
    expect(input().props.error).toBe(message); expect(input().props.value).toBe('12345678');
    expect(input().props.editable).toBe(true); await press('Continue'); expect(verify).toHaveBeenCalledTimes(2);
  },
);

it('keeps email on send failure and old code on resend failure; changing email clears errors/code', async () => {
  send.mockRejectedValueOnce(new Error('Could not connect.'));
  await mount(); await codeStep(); expect(input().props.value).toBe(' Pilot@Example.test ');
  expect(input().props.error).toBe('Could not connect.'); await press('Email me a code');
  await run(() => input().props.onChangeText('87654321')); await run(() => jest.advanceTimersByTime(60_000));
  send.mockRejectedValueOnce(new Error('Rate limited.')); await press('Send a new code');
  expect(input().props.value).toBe('87654321'); expect(input().props.error).toBe('Rate limited.');
  await press('Use a different email'); expect(input().props.label).toBe('Email'); expect(input().props.error).toBeNull();
  await run(() => input().props.onChangeText('other@example.test')); await press('Email me a code');
  expect(send).toHaveBeenLastCalledWith('other@example.test'); expect(input().props.value).toBe('');
});

it.each(['resolve', 'reject'] as const)('ignores a late send %s after dismissal, and re-entry has no draft or cooldown', async (outcome) => {
  const pending = deferred(); send.mockReturnValueOnce(pending.promise);
  await mount(); await codeStep(); await run(() => rendered.unmount()); await mount();
  await run(() => outcome === 'resolve' ? pending.resolve() : pending.reject(new Error('Old form failure')));
  expect(input().props.label).toBe('Email'); expect(input().props.value).toBe(''); expect(input().props.error).toBeNull();
  await run(() => input().props.onChangeText('other@example.test')); await press('Email me a code');
  expect(send).toHaveBeenCalledTimes(2);
});

it('keeps mounted input during an email-app round trip and refreshes the countdown on return', async () => {
  await mount(); await codeStep(); await run(() => input().props.onChangeText('1234'));
  const nativeState = AppState as unknown as { currentState: string };
  const previous = nativeState.currentState;
  await run(() => { nativeState.currentState = 'background'; rendered.update(form()); });
  await run(() => { jest.setSystemTime(62_000); nativeState.currentState = 'active'; jest.advanceTimersByTime(1000); rendered.update(form()); });
  expect(input().props.value).toBe('1234'); expect(control('Send a new code').props.disabled).toBe(false);
  nativeState.currentState = previous;
});
