import {
  persistLocationBatchTransaction,
  type SqlExecutor,
  type TransactionalDatabase,
} from '../repository-core';

class FakeTransaction implements SqlExecutor {
  locationSequence = 0;
  readonly events = new Set<string>();
  readonly sourceKeys = new Set<string>();
  readonly inserted: unknown[][] = [];
  checkpoint: unknown[] | null = null;

  async getFirstAsync<T>(source: string, ...params: unknown[]): Promise<T | null> {
    if (source.includes('FROM sessions')) {
      return { id: 'session-1', location_sequence: this.locationSequence } as T;
    }
    if (source.includes('FROM events')) {
      return (this.events.has(String(params[0])) ? { id: 1 } : null) as T | null;
    }
    return null;
  }

  async runAsync(source: string, ...params: unknown[]) {
    if (source.includes('INSERT OR IGNORE INTO location_fixes')) {
      const sourceKey = `${params[4]}:${params[6]}:${params[7]}`;
      if (this.sourceKeys.has(sourceKey)) return { changes: 0 };
      this.sourceKeys.add(sourceKey);
      this.inserted.push(params);
      this.locationSequence = Number(params[1]);
      return { changes: 1 };
    }
    if (source.includes('UPDATE sessions')) this.checkpoint = params;
    if (source.includes("'location_callback'")) this.events.add(String(params[2]));
    return { changes: 1 };
  }
}

class FakeDatabase implements TransactionalDatabase {
  transactionCount = 0;
  readonly transaction = new FakeTransaction();

  async withExclusiveTransactionAsync(task: (transaction: SqlExecutor) => Promise<void>) {
    this.transactionCount += 1;
    await task(this.transaction);
  }
}

const validLocation = (timestamp: number, latitude: number) => ({
  timestamp,
  coords: {
    latitude,
    longitude: 103.8,
    altitude: 120,
    altitudeAccuracy: 5,
    accuracy: 4,
    speed: 8,
    heading: 30,
  },
});

describe('transactional callback persistence', () => {
  it('inserts the full callback and its checkpoint in one exclusive transaction', async () => {
    const database = new FakeDatabase();
    const result = await persistLocationBatchTransaction(database, {
      callbackId: 'callback-a',
      receivedAt: 3000,
      locations: [
        validLocation(2000, 1.2),
        validLocation(1000, 1.1),
        validLocation(4000, 100),
      ],
    });

    expect(database.transactionCount).toBe(1);
    expect(result).toMatchObject({ reported: 3, inserted: 2, duplicates: 0, invalid: 1 });
    expect(database.transaction.inserted.map((params) => params[1])).toEqual([1, 2]);
    expect(database.transaction.inserted.map((params) => params[3])).toEqual([0, 1]);
    expect(database.transaction.checkpoint).toEqual([2, 2000, 2000, 3000, 'session-1']);
  });

  it('accounts for a redelivered callback without inserting fixes twice', async () => {
    const database = new FakeDatabase();
    const batch = {
      callbackId: 'callback-a',
      receivedAt: 3000,
      locations: [validLocation(1000, 1.1), validLocation(2000, 1.2)],
    };
    await persistLocationBatchTransaction(database, batch);
    const duplicate = await persistLocationBatchTransaction(database, batch);

    expect(duplicate).toMatchObject({
      reported: 2,
      inserted: 0,
      duplicates: 2,
      callbackDuplicate: true,
    });
    expect(database.transaction.inserted).toHaveLength(2);
  });

  it('deduplicates the same source fix delivered under a new callback ID', async () => {
    const database = new FakeDatabase();
    await persistLocationBatchTransaction(database, {
      callbackId: 'callback-a',
      receivedAt: 2000,
      locations: [validLocation(1000, 1.1)],
    });
    const result = await persistLocationBatchTransaction(database, {
      callbackId: 'callback-b',
      receivedAt: 3000,
      locations: [validLocation(1000, 1.1)],
    });
    expect(result).toMatchObject({ inserted: 0, duplicates: 1, invalid: 0 });
  });
});
