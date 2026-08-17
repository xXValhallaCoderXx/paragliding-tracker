export class OperationQueue {
  private tail: Promise<void> = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export class LifecycleCoordinator {
  private readonly queue = new OperationQueue();
  private currentRevision = 0;
  private operationActive = false;

  get revision(): number {
    return this.currentRevision;
  }

  get busy(): boolean {
    return this.operationActive;
  }

  run<T>(operation: () => Promise<T>): Promise<T> {
    return this.queue.run(async () => {
      this.operationActive = true;
      this.currentRevision += 1;
      try {
        return await operation();
      } finally {
        this.currentRevision += 1;
        this.operationActive = false;
      }
    });
  }

  beginSnapshot(allowDuringOperation = false): number | null {
    if (this.operationActive && !allowDuringOperation) return null;
    return this.currentRevision;
  }

  canCommitSnapshot(revision: number, allowDuringOperation = false): boolean {
    return (
      revision === this.currentRevision &&
      (!this.operationActive || allowDuringOperation)
    );
  }
}
