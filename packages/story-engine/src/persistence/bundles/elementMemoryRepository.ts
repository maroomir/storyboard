import {
  bundleMemoryDirectoryName,
  bundleMemoryFileExtension,
  bundleMemoryRelativePath,
  parseElementMemory,
  serializeElementMemory,
  type ElementMemory,
} from '@storyboard/story-model';

import type { BundleFileAccess } from '#engine/persistence/bundles/bundleFileAccess';

export class ElementMemoryRepository {
  public constructor(private readonly files: BundleFileAccess) {}

  public async read(bundlePath: string, threadId: string): Promise<ElementMemory> {
    const path: string = bundleMemoryRelativePath(bundlePath, threadId);
    const text: string | undefined = await this.files.readTextIfExists(path);

    return text === undefined ? {} : parseElementMemory(text, path);
  }

  public async write(bundlePath: string, threadId: string, memory: ElementMemory): Promise<void> {
    await this.files.writeText(
      bundleMemoryRelativePath(bundlePath, threadId),
      serializeElementMemory(memory),
    );
  }

  public async listThreads(bundlePath: string): Promise<readonly string[]> {
    return (await this.files.listFileNames(`${bundlePath}/${bundleMemoryDirectoryName}`))
      .filter((name) => name.endsWith(bundleMemoryFileExtension))
      .map((name) => name.slice(0, -bundleMemoryFileExtension.length))
      .sort();
  }
}
