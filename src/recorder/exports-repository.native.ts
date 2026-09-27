import { File } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { getArchiveDatabase } from './database.native';
import type { ExportArtifact } from './types';

interface SavedExportRow {
  path: string;
  sha256: string;
  byte_count: number;
  eligible_fix_count: number;
  artifact_version: number;
}

/** A saved filename alone is not evidence: only return bytes matching the stored receipt. */
export async function readVerifiedSessionIgc(sessionId: string): Promise<{
  artifact: ExportArtifact;
  content: string;
  artifactVersion: number;
} | null> {
  const database = await getArchiveDatabase();
  const rows = await database.getAllAsync<SavedExportRow>(
    `SELECT path, sha256, byte_count, eligible_fix_count, artifact_version
       FROM exports WHERE session_id = ? AND kind = 'igc' ORDER BY created_at DESC, id DESC`,
    sessionId,
  );
  for (const row of rows) {
    const file = new File(row.path);
    if (!file.exists) continue;
    const content = await file.text();
    if (new TextEncoder().encode(content).byteLength !== row.byte_count) continue;
    const sha256 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, content);
    if (sha256 !== row.sha256) continue;
    return {
      content,
      artifactVersion: row.artifact_version,
      artifact: { sessionId, kind: 'igc', uri: row.path, sha256, byteCount: row.byte_count,
        eligibleFixCount: row.eligible_fix_count },
    };
  }
  return null;
}
