import { POSTCARD_SIZE, type PostcardFormat } from './presentation';

export const POSTCARD_RETENTION_MS = 24 * 60 * 60 * 1000;
export function captureDimensions(format: PostcardFormat, platform: string, pixelRatio: number) {
  const size = POSTCARD_SIZE[format];
  const divisor = platform === 'ios' ? pixelRatio : 1;
  if (!Number.isFinite(divisor) || divisor <= 0) throw new Error('Invalid display scale.');
  return { width: size.width / divisor, height: size.height / divisor };
}
export function localFileUri(uri: string): string {
  if (uri.startsWith('file:///')) return uri;
  if (uri.startsWith('/')) return `file://${uri}`;
  throw new Error('The postcard capture did not produce a local file.');
}
export function expiredPostcard(name: string, now: number): boolean {
  const match = /^postcard-(\d+)-[\w-]+\.png$/.exec(name);
  return Boolean(match && now - Number(match[1]) >= POSTCARD_RETENTION_MS);
}

export interface PostcardExportAdapter {
  cleanup: () => Promise<void>;
  available: () => Promise<boolean>;
  capture: () => Promise<string>;
  validate: (uri: string) => Promise<void>;
  copy: (uri: string) => Promise<string>;
  release: (uri: string) => void;
  remove: (uri: string) => Promise<void>;
  share: (uri: string) => Promise<void>;
}

/** One owner per composer. Cancellation stays cancelled even after foregrounding again. */
export class PostcardExporter {
  private operation: { cancelled: boolean; sharing: boolean } | null = null;
  get busy() { return this.operation !== null; }
  cancel() { if (this.operation && !this.operation.sharing) this.operation.cancelled = true; }

  async run(adapter: PostcardExportAdapter): Promise<'shared' | 'abandoned' | 'busy'> {
    if (this.operation) return 'busy';
    const operation = { cancelled: false, sharing: false };
    this.operation = operation;
    let original: string | null = null;
    let cached: string | null = null;
    try {
      await adapter.cleanup();
      if (operation.cancelled) return 'abandoned';
      if (!await adapter.available()) throw new Error('Image sharing is unavailable on this device.');
      if (operation.cancelled) return 'abandoned';
      original = await adapter.capture();
      if (operation.cancelled) return 'abandoned';
      const uri = localFileUri(original);
      await adapter.validate(uri);
      if (operation.cancelled) return 'abandoned';
      cached = await adapter.copy(uri);
      adapter.release(original);
      original = null;
      if (operation.cancelled) return 'abandoned';
      // From this point the OS may hold a reader even if its promise rejects or dismisses.
      operation.sharing = true;
      await adapter.share(cached);
      return 'shared';
    } catch (error) {
      if (operation.cancelled) return 'abandoned';
      throw error;
    } finally {
      try {
        if (original) adapter.release(original);
      } finally {
        try { if (cached && !operation.sharing) await adapter.remove(cached); }
        finally { this.operation = null; }
      }
    }
  }
}
