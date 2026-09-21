import { captureSharingConsent, setCaptureSharingContext } from '../sharing-preference-cache';

afterEach(() => setCaptureSharingContext(null, null, () => false));
it('requires a direct current owner and known enabled consent before allocating an operation identity', () => {
  const id = jest.fn(() => 'operation');
  expect(captureSharingConsent(id)).toBeNull();
  setCaptureSharingContext('A', { enabled: true, generation: null }, () => true);
  expect(captureSharingConsent(id)).toBeNull();
  setCaptureSharingContext('A', { enabled: false, generation: 'g' }, () => true);
  expect(captureSharingConsent(id)).toBeNull();
  setCaptureSharingContext('A', { enabled: true, generation: 'g' }, () => false);
  expect(captureSharingConsent(id)).toBeNull();
  expect(id).not.toHaveBeenCalled();
});
it('revokes a captured stamp if sign-out, account switch or consent change happens before database commit', () => {
  let signedIn = true;
  setCaptureSharingContext('A', { enabled: true, generation: 'g' }, () => signedIn);
  const capture = captureSharingConsent(() => 'operation')!;
  expect(capture.stamp).toEqual({ ownerUserId: 'A', generation: 'g', operationId: 'operation' });
  expect(capture.isCurrent()).toBe(true);
  signedIn = false; expect(capture.isCurrent()).toBe(false);
  signedIn = true;
  setCaptureSharingContext('B', { enabled: true, generation: 'other' }, () => true);
  expect(capture.isCurrent()).toBe(false);
});
