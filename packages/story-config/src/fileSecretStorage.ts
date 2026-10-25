import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

import type {
  StoryboardSecretStorageChangeEvent,
  StoryboardSecretStorageLike,
} from '@storyboard/story-ai';

import { watchFiles } from '#config/fileWatch';
import type { DisposableHandle } from '@storyboard/story-model';

export function createFileSecretStorage(secretsFile: string): StoryboardSecretStorageLike {
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

  async function writeAll(secrets: Record<string, string>): Promise<void> {
    const temporary: string = `${secretsFile}.tmp-${process.pid.toString(36)}`;

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

  let pending: Promise<unknown> = Promise.resolve();

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next: Promise<T> = pending.then(operation, operation);
    pending = next.catch(() => undefined);
    return next;
  }

  const listeners: Set<(event: StoryboardSecretStorageChangeEvent) => void> = new Set<
    (event: StoryboardSecretStorageChangeEvent) => void
  >();
  let watcher: DisposableHandle | undefined;
  let knownKeys: Set<string> = new Set<string>();

  async function notifyAll(): Promise<void> {
    let current: Set<string>;

    try {
      current = new Set(Object.keys(await readAll()));
    } catch {
      return;
    }

    const changed: Set<string> = new Set([...knownKeys, ...current]);
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
        const secrets: Record<string, string> = await readAll();
        delete secrets[key];
        await writeAll(secrets);
      }),
    onDidChange: (
      listener: (event: StoryboardSecretStorageChangeEvent) => void,
    ): DisposableHandle => {
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
