import type { DisposableHandle } from '@storyboard/story-model';
import { existsSync, watch, type FSWatcher } from 'node:fs';
import { basename, dirname } from 'node:path';

const settleDelayMs: number = 150;

export function watchFiles(files: readonly string[], listener: () => void): DisposableHandle {
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

  const byDirectory: Map<string, Set<string>> = new Map<string, Set<string>>();

  for (const file of files) {
    const directory: string = dirname(file);
    const names: Set<string> = byDirectory.get(directory) ?? new Set<string>();
    names.add(basename(file));
    byDirectory.set(directory, names);
  }

  for (const [directory, names] of byDirectory) {
    if (!existsSync(directory)) {
      continue;
    }

    try {
      const watcher: FSWatcher = watch(directory, (_eventType, fileName) => {
        if (fileName === null || names.has(String(fileName))) {
          schedule();
        }
      });
      watcher.on('error', () => undefined);
      watchers.push(watcher);
    } catch {
      continue;
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
