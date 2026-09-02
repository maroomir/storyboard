import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

import type {
  StoryboardSecretStorageChangeEvent,
  StoryboardSecretStorageLike,
} from '@storyboard/story-ai';

import { watchFiles } from '#config/fileWatch';

// SECURITY: API keys live in a 0600 file under the Storyboard home, and the directory is 0700. The
// values are never logged, and the file is rewritten whole so a partial write cannot leak one key
// into another's slot.
export function createFileSecretStorage(secretsFile: string): StoryboardSecretStorageLike {
  // A file that exists but will not parse is not an empty store — treating it as one would let the
  // next write erase every key in it. Refuse instead and let the operator look.
  async function readAll(): Promise<Record<string, string>> {
    let raw: string;

    try {
      raw = await fs.readFile(secretsFile, 'utf8');
    } catch {
      return {};
    }

    const parsed: unknown = JSON.parse(raw);

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`시크릿 파일을 읽을 수 없습니다: ${secretsFile}`);
    }

    return parsed as Record<string, string>;
  }

  // Truncate-and-write loses every key if the process dies mid-write. Write a sibling at 0600 and
  // rename, so the file is either the old set or the new one.
  async function writeAll(secrets: Record<string, string>): Promise<void> {
    const temporary = `${secretsFile}.tmp-${process.pid.toString(36)}`;

    await fs.mkdir(dirname(secretsFile), { recursive: true, mode: 0o700 });

    try {
      await fs.writeFile(temporary, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
      await fs.chmod(temporary, 0o600);
      await fs.rename(temporary, secretsFile);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
  }

  // A read-modify-write from two processes at once loses one key. Serialising within the process
  // closes the common case; the file is per-user, so cross-process contention is not a real path.
  let pending: Promise<unknown> = Promise.resolve();

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = pending.then(operation, operation);
    pending = next.catch(() => undefined);
    return next;
  }

  // The file does not say which key changed, so every listener is told about its own key and
  // re-reads; the apps only ever ask "is there a key now", which that answers.
  const listeners = new Set<(event: StoryboardSecretStorageChangeEvent) => void>();
  let watcher: { readonly dispose: () => void } | undefined;
  let knownKeys = new Set<string>();

  async function notifyAll(): Promise<void> {
    let current: Set<string>;

    try {
      current = new Set(Object.keys(await readAll()));
    } catch {
      return;
    }

    const changed = new Set([...knownKeys, ...current]);
    knownKeys = current;

    for (const key of changed) {
      for (const listener of listeners) {
        listener({ key });
      }
    }
  }

  return {
    get: async (key) => (await readAll())[key],
    store: async (key, value) =>
      serialize(async () => {
        await writeAll({ ...(await readAll()), [key]: value });
      }),
    delete: async (key) =>
      serialize(async () => {
        const secrets = await readAll();
        delete secrets[key];
        await writeAll(secrets);
      }),
    onDidChange: (listener) => {
      listeners.add(listener);

      if (!watcher) {
        void readAll().then((secrets) => {
          knownKeys = new Set(Object.keys(secrets));
        });
        watcher = watchFiles([secretsFile], () => void notifyAll());
      }

      return {
        dispose: (): void => {
          listeners.delete(listener);

          if (listeners.size === 0) {
            watcher?.dispose();
            watcher = undefined;
          }
        },
      };
    },
  };
}
