import { errorMessage } from '../error-message';

/**
 * The bug these guard: RTK Query's `.unwrap()` rethrows the serialized error, not the
 * `Error`, so an `instanceof Error` check misses it and `String()` turns it into
 * "[object Object]". Every assertion here is about a value that really reaches a screen.
 */

describe('errorMessage', () => {
  it('reads a real Error', () => {
    expect(errorMessage(new Error('Flight abc was not found.'))).toBe('Flight abc was not found.');
  });

  it('reads the serialized shape RTK Query rethrows', () => {
    // Exactly what `repositoryQuery` puts in the cache: a plain object, no prototype chain
    // to Error. This is the case that used to print "[object Object]".
    expect(errorMessage({ message: 'CHECK constraint failed: flights' })).toBe(
      'CHECK constraint failed: flights',
    );
  });

  it('keeps the message when the serialized error also carries a code', () => {
    expect(errorMessage({ message: 'Session expired.', code: 'auth/expired' })).toBe(
      'Session expired.',
    );
  });

  it('passes a bare string through', () => {
    expect(errorMessage('Offline.')).toBe('Offline.');
  });

  it('never stringifies an object into [object Object]', () => {
    // The whole point. Anything without words gets a sentence instead.
    expect(errorMessage({})).toBe('Something went wrong.');
    expect(errorMessage({ code: 'SQLITE_CONSTRAINT' })).toBe('Something went wrong.');
    expect(errorMessage([1, 2, 3])).toBe('Something went wrong.');
  });

  it('falls back rather than printing the word null or undefined', () => {
    expect(errorMessage(null)).toBe('Something went wrong.');
    expect(errorMessage(undefined)).toBe('Something went wrong.');
  });

  it('falls back for an error carrying no words', () => {
    // `new Error()` and `{ message: '' }` both stringify to nothing useful.
    expect(errorMessage(new Error())).toBe('Something went wrong.');
    expect(errorMessage(new Error('   '))).toBe('Something went wrong.');
    expect(errorMessage({ message: '' })).toBe('Something went wrong.');
    expect(errorMessage({ message: 42 })).toBe('Something went wrong.');
  });

  it('lets the caller phrase the fallback for its own surface', () => {
    expect(errorMessage({}, 'Could not save this flight.')).toBe('Could not save this flight.');
  });

  it('reads a subclass of Error', () => {
    // RecorderError and CloudError both extend Error and both reach these surfaces.
    class RecorderError extends Error {
      code = 'recorder/busy';
    }
    expect(errorMessage(new RecorderError('Recorder is busy.'))).toBe('Recorder is busy.');
  });
});
