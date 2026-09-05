import { captureDimensions, expiredPostcard, localFileUri, POSTCARD_RETENTION_MS, PostcardExporter, type PostcardExportAdapter } from '../export';

function adapter(): jest.Mocked<PostcardExportAdapter> {
  return { cleanup: jest.fn().mockResolvedValue(undefined), available: jest.fn().mockResolvedValue(true),
    capture: jest.fn().mockResolvedValue('/tmp/capture.png'), validate: jest.fn().mockResolvedValue(undefined),
    copy: jest.fn().mockResolvedValue('file:///cache/postcards/card.png'), release: jest.fn(),
    remove: jest.fn().mockResolvedValue(undefined), share: jest.fn().mockResolvedValue(undefined) };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

it.each([['android', 3, 1080, 1920], ['ios', 3, 360, 640], ['ios', 2, 540, 960]] as const)(
  'uses correct output dimensions on %s at density %s', (platform, density, width, height) => {
    expect(captureDimensions('story', platform, density)).toEqual({ width, height });
    expect(captureDimensions('square', platform, density)).toEqual({ width, height: width });
  });
it('normalizes only local capture files', () => {
  expect(localFileUri('/tmp/a b.png')).toBe('file:///tmp/a b.png');
  expect(localFileUri('file:///tmp/a.png')).toBe('file:///tmp/a.png');
  for (const uri of ['https://a/image', 'content://a', '', 'relative.png']) expect(() => localFileUri(uri)).toThrow();
});
it('expires only owned postcard PNGs, at 24 hours', () => {
  expect(expiredPostcard('postcard-1000-id.png', 1000 + POSTCARD_RETENTION_MS - 1)).toBe(false);
  expect(expiredPostcard('postcard-1000-id.png', 1000 + POSTCARD_RETENTION_MS)).toBe(true);
  expect(expiredPostcard('postcard-9999999999999-id.png', Date.now())).toBe(false);
  expect(expiredPostcard('unrelated.png', Date.now())).toBe(false);
});
it('validates and copies before releasing, retains OS files and treats dismissal neutrally', async () => {
  const port = adapter();
  expect(await new PostcardExporter().run(port)).toBe('shared');
  expect(port.validate).toHaveBeenCalledWith('file:///tmp/capture.png');
  expect(port.copy).toHaveBeenCalledWith('file:///tmp/capture.png');
  expect(port.release).toHaveBeenCalledTimes(1);
  expect(port.copy.mock.invocationCallOrder[0]).toBeLessThan(port.release.mock.invocationCallOrder[0]);
  expect(port.release.mock.invocationCallOrder[0]).toBeLessThan(port.share.mock.invocationCallOrder[0]);
  expect(port.remove).not.toHaveBeenCalled();
});
it('locks duplicate taps until sharing finishes', async () => {
  const exporter = new PostcardExporter(); const port = adapter(); const sheet = deferred<void>();
  port.share.mockReturnValue(sheet.promise);
  const first = exporter.run(port);
  expect(await exporter.run(port)).toBe('busy');
  sheet.resolve(); await first;
  expect(port.capture).toHaveBeenCalledTimes(1); expect(exporter.busy).toBe(false);
});
it.each(['capture', 'validate', 'copy'] as const)('abandons on close/background while %s is pending', async (stage) => {
  const exporter = new PostcardExporter(); const port = adapter(); const pending = deferred<never>();
  port[stage].mockImplementation(() => { exporter.cancel(); return pending.promise; });
  const run = exporter.run(port);
  pending.resolve((stage === 'capture' ? '/tmp/capture.png' : stage === 'copy' ? 'file:///cache/card.png' : undefined) as never);
  expect(await run).toBe('abandoned');
  expect(port.share).not.toHaveBeenCalled();
  expect(port.release).toHaveBeenCalledTimes(1);
  expect(port.remove).toHaveBeenCalledTimes(stage === 'copy' ? 1 : 0);
});
it('does not cancel a share sheet already handed to the OS', async () => {
  const exporter = new PostcardExporter(); const port = adapter();
  port.share.mockImplementation(async () => { exporter.cancel(); });
  expect(await exporter.run(port)).toBe('shared'); expect(port.remove).not.toHaveBeenCalled();
});
it.each(['cleanup', 'available', 'capture', 'validate', 'copy', 'share'] as const)('surfaces %s errors and permits an explicit retry', async (stage) => {
  const exporter = new PostcardExporter(); const port = adapter();
  port[stage].mockRejectedValueOnce(new Error('failed'));
  await expect(exporter.run(port)).rejects.toThrow('failed');
  expect(exporter.busy).toBe(false);
  if (stage === 'share') expect(port.remove).not.toHaveBeenCalled();
  expect(await exporter.run(port)).toBe('shared');
});
it('does not capture when native sharing is unavailable', async () => {
  const port = adapter(); port.available.mockResolvedValue(false);
  await expect(new PostcardExporter().run(port)).rejects.toThrow('unavailable');
  expect(port.capture).not.toHaveBeenCalled();
});
