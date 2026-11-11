import { joinStoryPath, type StoryUri } from '@storyboard/story-model';

import type { IFileSystem } from '#engine/ports/fileSystem';

export interface BundleFileAccessDependencies {
  readonly fileSystem: IFileSystem;
  readonly workspaceRoot: StoryUri;
}

export class BundleFileAccess {
  public constructor(private readonly dependencies: BundleFileAccessDependencies) {}

  public uriOf(relativePath: string): StoryUri {
    return joinStoryPath(this.dependencies.workspaceRoot, ...relativePath.split('/'));
  }

  public async readTextIfExists(relativePath: string): Promise<string | undefined> {
    const uri: StoryUri = this.uriOf(relativePath);
    if (!(await this.dependencies.fileSystem.exists(uri))) {
      return undefined;
    }

    return new TextDecoder().decode(await this.dependencies.fileSystem.readFile(uri));
  }

  public async writeText(relativePath: string, text: string): Promise<void> {
    await this.dependencies.fileSystem.writeFile(
      this.uriOf(relativePath),
      new TextEncoder().encode(text),
    );
  }

  public async listFileNames(relativeDirectory: string): Promise<readonly string[]> {
    const uri: StoryUri = this.uriOf(relativeDirectory);
    return (await this.dependencies.fileSystem.exists(uri))
      ? await this.dependencies.fileSystem.listFileNames(uri)
      : [];
  }
}
