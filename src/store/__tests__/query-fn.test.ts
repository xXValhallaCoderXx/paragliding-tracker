import { repositoryQuery, serializeQueryError } from '../query-fn';

/**
 * These guard one rule: a `queryFn` must never throw.
 *
 * RTK Query rethrows whatever a `queryFn` throws, and an entry that threw never registers
 * as providing its tags — so every later `invalidateTags` silently misses it. A one-off
 * SQLite failure would become permanent staleness on a screen that looks fine.
 */

class CodedError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

describe('serializeQueryError', () => {
  it('keeps the message of a plain Error and adds no code', () => {
    expect(serializeQueryError(new Error('database is locked'))).toEqual({
      message: 'database is locked',
    });
  });

  it('carries the code off a coded error, as RecorderError and CloudError have', () => {
    expect(serializeQueryError(new CodedError('storage_error', 'could not read'))).toEqual({
      code: 'storage_error',
      message: 'could not read',
    });
  });

  it('ignores a non-string code rather than putting one in the store', () => {
    const error = Object.assign(new Error('odd'), { code: 42 });
    expect(serializeQueryError(error)).toEqual({ message: 'odd' });
  });

  it('survives a thrown non-Error', () => {
    expect(serializeQueryError('just a string')).toEqual({ message: 'just a string' });
    expect(serializeQueryError(undefined)).toEqual({ message: 'undefined' });
  });

  it('returns a plain object, never the Error instance', () => {
    // An Error in Redux state is what serializableStateInvariant exists to catch.
    const result = serializeQueryError(new Error('boom'));
    expect(result).not.toBeInstanceOf(Error);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });
});

describe('repositoryQuery', () => {
  it('passes a successful read straight through', async () => {
    await expect(repositoryQuery(async () => ['a', 'b'])).resolves.toEqual({
      data: ['a', 'b'],
    });
  });

  it('turns a rejection into cache state instead of throwing', async () => {
    await expect(
      repositoryQuery(async () => {
        throw new CodedError('storage_error', 'no such column');
      }),
    ).resolves.toEqual({ error: { code: 'storage_error', message: 'no such column' } });
  });

  it('catches a synchronous throw too, not just a rejection', async () => {
    await expect(
      repositoryQuery(() => {
        throw new Error('threw before returning a promise');
      }),
    ).resolves.toEqual({ error: { message: 'threw before returning a promise' } });
  });

  it('never rejects, whatever the read does', async () => {
    // The whole contract in one assertion.
    for (const read of [
      async () => {
        throw 'a string';
      },
      async () => {
        throw null;
      },
      () => Promise.reject(new Error('rejected')),
    ]) {
      await expect(repositoryQuery(read as () => Promise<unknown>)).resolves.toHaveProperty(
        'error',
      );
    }
  });

  it('preserves a falsy but valid result rather than treating it as an error', async () => {
    // getFlight legitimately resolves null for a flight that no longer exists.
    await expect(repositoryQuery(async () => null)).resolves.toEqual({ data: null });
    await expect(repositoryQuery(async () => 0)).resolves.toEqual({ data: 0 });
    await expect(repositoryQuery(async () => [])).resolves.toEqual({ data: [] });
  });
});
