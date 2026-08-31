import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';

import type { StoryboardSecretStorageLike } from '@storyboard/story-ai';

// SECURITY: API keys live in a 0600 file under the Storyboard home, and the directory is 0700. The
// values are never logged, and the file is rewritten whole so a partial write cannot leak one key
// into another's slot.
export function createFileSecretStorage(secretsFile: string): StoryboardSecretStorageLike {
  async function readAll(): Promise<Record<string, string>> {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(secretsFile, 'utf8'));
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, string>)
        : {};
    } catch {
      return {};
    }
  }

  async function writeAll(secrets: Record<string, string>): Promise<void> {
    await fs.mkdir(dirname(secretsFile), { recursive: true, mode: 0o700 });
    await fs.writeFile(secretsFile, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
    await fs.chmod(secretsFile, 0o600);
  }

  return {
    get: async (key) => (await readAll())[key],
    store: async (key, value) => {
      await writeAll({ ...(await readAll()), [key]: value });
    },
    delete: async (key) => {
      const secrets = await readAll();
      delete secrets[key];
      await writeAll(secrets);
    },
  };
}
