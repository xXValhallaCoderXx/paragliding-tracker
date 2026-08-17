import { LifecycleCoordinator, OperationQueue } from '../operation-queue';

describe('OperationQueue', () => {
  it('serializes operations and keeps going after a rejection', async () => {
    const queue = new OperationQueue();
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.run(async () => {
      order.push('first:start');
      await firstGate;
      order.push('first:end');
    });
    const second = queue.run(async () => {
      order.push('second');
      throw new Error('expected');
    });
    const third = queue.run(async () => {
      order.push('third');
    });

    await Promise.resolve();
    expect(order).toEqual(['first:start']);
    releaseFirst?.();
    await first;
    await expect(second).rejects.toThrow('expected');
    await third;
    expect(order).toEqual(['first:start', 'first:end', 'second', 'third']);
  });
});

describe('LifecycleCoordinator', () => {
  it('invalidates a snapshot read that began before a lifecycle operation', async () => {
    const coordinator = new LifecycleCoordinator();
    const pollRevision = coordinator.beginSnapshot();
    let releaseArm: (() => void) | undefined;
    const armGate = new Promise<void>((resolve) => {
      releaseArm = resolve;
    });

    const arm = coordinator.run(async () => armGate);
    await Promise.resolve();

    expect(pollRevision).toBe(0);
    expect(coordinator.canCommitSnapshot(pollRevision!)).toBe(false);
    expect(coordinator.beginSnapshot()).toBeNull();

    releaseArm?.();
    await arm;
    expect(coordinator.canCommitSnapshot(pollRevision!)).toBe(false);
  });
});
