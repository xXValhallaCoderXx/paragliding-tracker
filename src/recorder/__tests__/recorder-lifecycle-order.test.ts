import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const serviceSource = readFileSync(
  resolve(process.cwd(), 'src/recorder/recorder-service.native.ts'),
  'utf8',
);

function methodSource(startMarker: string, endMarker: string): string {
  const start = serviceSource.indexOf(startMarker);
  const end = serviceSource.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return serviceSource.slice(start, end);
}

describe('native recorder crash-boundary ordering', () => {
  it('captures and starts persisting Stop before entering the lifecycle FIFO', () => {
    const publicStop = methodSource(
      'stop(): Promise<void>',
      'private async requestAndCompleteStop',
    );
    const requestedAt = publicStop.indexOf('const requestedAt = Date.now()');
    const requestOperation = publicStop.indexOf('this.requestAndCompleteStop(requestedAt)');

    expect(requestedAt).toBeGreaterThanOrEqual(0);
    expect(requestOperation).toBeGreaterThan(requestedAt);
    expect(publicStop).not.toContain('runLifecycleOperation');
  });

  it('persists the canonical Stop before queueing any native capture teardown', () => {
    const source = methodSource(
      'private async requestAndCompleteStop',
      'recover(): Promise<RecorderSnapshot>',
    );
    const durableStop = source.indexOf('await requestSessionStop');
    const lifecycleQueue = source.indexOf('return this.runLifecycleOperation');

    expect(durableStop).toBeGreaterThanOrEqual(0);
    expect(lifecycleQueue).toBeGreaterThan(durableStop);
    expect(source.slice(durableStop)).not.toContain("this.state = 'recording'");
  });

  it('retries a previously persisted Stop instead of treating stopping as a no-op', () => {
    const source = methodSource(
      'private async requestAndCompleteStop',
      'recover(): Promise<RecorderSnapshot>',
    );
    const durableStop = source.indexOf('await requestSessionStop');
    const retry = source.indexOf('await this.completePendingSessionStop(session)');

    expect(durableStop).toBeGreaterThanOrEqual(0);
    expect(retry).toBeGreaterThan(durableStop);
  });

  it('resolves a durable Stop before interrupted or GPS recovery branches', () => {
    const source = methodSource(
      'private async recoverInternal()',
      'private async completePendingSessionStop',
    );
    const durableStop = source.indexOf('if (session.manualStopAt !== null)');
    const pendingRecovery = source.indexOf('getPendingSessionRecoveryAttempt');
    const interrupted = source.indexOf("if (session.status === 'interrupted')");
    const health = source.indexOf('deriveCaptureHealth');

    expect(durableStop).toBeGreaterThanOrEqual(0);
    expect(pendingRecovery).toBeGreaterThan(durableStop);
    expect(interrupted).toBeGreaterThan(pendingRecovery);
    expect(health).toBeGreaterThan(interrupted);
  });

  it('never starts location while reconciling an already-persisted attempt', () => {
    const source = methodSource(
      'private async reconcilePendingRecoveryAttempt',
      'private async waitForRecoveryAttemptProof',
    );

    expect(source).toContain('confirmSessionRecoveryAttempt');
    expect(source).not.toContain('startLocationTask');
    expect(source).not.toContain('startLocationUpdates');
  });

  it('drains the final proof read before failing an attempt whose task disappeared', () => {
    const source = methodSource(
      'private async reconcilePendingRecoveryAttempt',
      'private async waitForRecoveryAttemptProof',
    );

    expect(source.indexOf('await this.getFinalRecoveryAttemptProof')).toBeLessThan(
      source.indexOf('lost its native location task'),
    );
  });

  it('claims the recovery after old-task teardown and before the one native start', () => {
    const source = methodSource(
      'private async attemptSessionRecovery',
      'private async failSessionRecovery',
    );
    const nativeStop = source.indexOf('await this.stopLocationTask()');
    const durableClaim = source.indexOf('await beginSessionRecoveryAttempt');
    const nativeStart = source.indexOf('await this.startLocationUpdates()');

    expect(nativeStop).toBeGreaterThanOrEqual(0);
    expect(durableClaim).toBeGreaterThan(nativeStop);
    expect(nativeStart).toBeGreaterThan(durableClaim);
    expect(source).toContain('waitForRecoveryAttemptProof');
    expect(source).toContain('confirmSessionRecoveryAttempt');
  });
});
