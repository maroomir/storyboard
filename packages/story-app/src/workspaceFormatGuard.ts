import type { IFileSystem } from '@storyboard/story-engine';
import {
  assertSupportedProjectVersion,
  getStoryboardProjectPaths,
  ProjectVersionError,
  type StoryUri,
} from '@storyboard/story-model';

export type WorkspaceFormatCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: ProjectVersionError };

function parseJsonOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export class WorkspaceFormatGuard {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async check(workspaceRoot: StoryUri): Promise<WorkspaceFormatCheck> {
    const projectJson: StoryUri = getStoryboardProjectPaths(workspaceRoot).projectJson;
    if (!(await this.fileSystem.exists(projectJson))) {
      return { ok: true };
    }

    const rawProject: unknown = parseJsonOrUndefined(
      new TextDecoder().decode(await this.fileSystem.readFile(projectJson)),
    );
    if (rawProject === undefined) {
      return { ok: true };
    }

    try {
      assertSupportedProjectVersion(rawProject);
      return { ok: true };
    } catch (error) {
      if (error instanceof ProjectVersionError) {
        return { ok: false, error };
      }
      throw error;
    }
  }

  public async refuse(workspaceRoot: StoryUri): Promise<void> {
    const check: WorkspaceFormatCheck = await this.check(workspaceRoot);
    if (!check.ok) {
      throw check.error;
    }
  }
}
