import { existsSync, watch, type FSWatcher } from 'node:fs';
import { basename, dirname } from 'node:path';

const settleDelayMs = 150;

// Watches the parent directories rather than the files, because an atomic rename replaces the
// inode and a watcher pinned to the old file goes quiet. A directory that does not exist yet is
// skipped: the first write creates it, and the next `watchFiles` (or process) picks it up.
export function watchFiles(
  files: readonly string[],
  listener: () => void,
): { readonly dispose: () => void } {
  const watchers: FSWatcher[] = [];
  let timer: NodeJS.Timeout | undefined;

  const schedule = (): void => {
    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      timer = undefined;
      listener();
    }, settleDelayMs);
  };

  const byDirectory = new Map<string, Set<string>>();

  for (const file of files) {
    const directory = dirname(file);
    const names = byDirectory.get(directory) ?? new Set<string>();
    names.add(basename(file));
    byDirectory.set(directory, names);
  }

  for (const [directory, names] of byDirectory) {
    if (!existsSync(directory)) {
      continue;
    }

    try {
      const watcher = watch(directory, (_eventType, fileName) => {
        if (fileName === null || names.has(String(fileName))) {
          schedule();
        }
      });
      watcher.on('error', () => undefined);
      watchers.push(watcher);
    } catch {
      // A platform without recursive/dir watch support degrades to no live refresh.
    }
  }

  return {
    dispose: (): void => {
      if (timer) {
        clearTimeout(timer);
      }

      for (const watcher of watchers) {
        watcher.close();
      }
    },
  };
}
