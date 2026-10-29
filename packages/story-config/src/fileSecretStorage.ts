import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

import type {
  StoryboardSecretStorageChangeEvent,
  StoryboardSecretStorageLike,
} from '@storyboard/story-ai';

import { watchFiles } from '#config/fileWatch';
import type { DisposableHandle } from '@storyboard/story-model';

type SecretChangeListener = (event: StoryboardSecretStorageChangeEvent) => void;

class FileSecretStorage implements StoryboardSecretStorageLike {
  private readonly listeners: Set<SecretChangeListener> = new Set<SecretChangeListener>();
  private pending: Promise<unknown> = Promise.resolve();
  private watcher: DisposableHandle | undefined;
  private knownKeys: Set<string> = new Set<string>();

  public constructor(private readonly secretsFile: string) {}

  public readonly get = async (key: string): Promise<string | undefined> =>
    (await this.readAll())[key];

  public readonly store = async (key: string, value: string): Promise<void> =>
    this.serialize(async () => {
      await this.writeAll({ ...(await this.readAll()), [key]: value });
    });

  public readonly delete = async (key: string): Promise<void> =>
    this.serialize(async () => {
      const secrets: Record<string, string> = await this.readAll();
      delete secrets[key];
      await this.writeAll(secrets);
    });

  public readonly onDidChange = (listener: SecretChangeListener): DisposableHandle => {
    this.listeners.add(listener);

    if (!this.watcher) {
      void this.readAll().then((secrets) => {
        this.knownKeys = new Set(Object.keys(secrets));
      });
      this.watcher = watchFiles([this.secretsFile], () => void this.notifyAll());
    }

    return {
      dispose: (): void => {
        this.listeners.delete(listener);

        if (this.listeners.size === 0) {
          this.watcher?.dispose();
          this.watcher = undefined;
        }
      },
    };
  };

  private async readAll(): Promise<Record<string, string>> {
    let raw: string;

    try {
      raw = await fs.readFile(this.secretsFile, 'utf8');
    } catch {
      return {};
    }

    const parsed: unknown = JSON.parse(raw);

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`시크릿 파일을 읽을 수 없습니다: ${this.secretsFile}`);
    }

    return parsed as Record<string, string>;
  }

  private async writeAll(secrets: Record<string, string>): Promise<void> {
    const temporary: string = `${this.secretsFile}.tmp-${process.pid.toString(36)}`;

    await fs.mkdir(dirname(this.secretsFile), { recursive: true, mode: 0o700 });

    try {
      await fs.writeFile(temporary, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
      await fs.chmod(temporary, 0o600);
      await fs.rename(temporary, this.secretsFile);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next: Promise<T> = this.pending.then(operation, operation);
    this.pending = next.catch(() => undefined);
    return next;
  }

  private async notifyAll(): Promise<void> {
    let current: Set<string>;

    try {
      current = new Set(Object.keys(await this.readAll()));
    } catch {
      return;
    }

    const changed: Set<string> = new Set([...this.knownKeys, ...current]);
    this.knownKeys = current;

    for (const key of changed) {
      for (const listener of this.listeners) {
        listener({ key });
      }
    }
  }
}

export function createFileSecretStorage(secretsFile: string): StoryboardSecretStorageLike {
  return new FileSecretStorage(secretsFile);
}
