import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

// Writes via a temp file + rename so readers never observe a partially written file (QA-06,
// File I/O connector). The rename is atomic within a directory on POSIX filesystems. When `mode` is
// given, the temp file is created with it so a secret-bearing file (e.g. config.json, 0o600) is
// never briefly world-readable and a crash-interrupted rename cannot leave a permissive file —
// rename preserves the temp's mode. On failure the temp is unlinked so no orphan leaks into the dir.
export function atomicWriteFile(path: string, content: string, mode?: number): void {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });

  const tempPath = join(directory, `.${basename(path)}.${process.pid}.tmp`);
  try {
    writeFileSync(
      tempPath,
      content,
      mode === undefined ? { encoding: 'utf8' } : { encoding: 'utf8', mode },
    );
    renameSync(tempPath, path);
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch {
      // The temp file may never have been created; nothing to clean up.
    }
    throw error;
  }
}
