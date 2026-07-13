import * as vscode from 'vscode';

import type {
  ISeedProjectRepository,
  SeedSyncSource,
} from '../../../application/project/seedProjectUseCase';
import type { StoryboardLogger } from '../../vscode/logger';
import { getStoryboardProjectPaths } from '../../vscode/pathConventions';
import { uriExists } from '../../vscode/workspace';
import {
  collectTrackedCardAndSceneRelativePathsFromFileNames,
  normalizeRelativePath,
  SeedWriteAbortedError,
  type SeedFileWriteEntry,
} from '../../../files/seedImport';
import {
  readDirectoryFileNamesOnly,
  readParsedSeedEnvelopeFromWorkspaceRoot,
} from '../../../files/seedEnvelopeFromWorkspace';
import type {
  DecodedSeedContent,
  WorkspaceContent,
} from '../../../services/seedcoat/projectAdapter';
import {
  createStoryboardDirectories,
  ensureWorkspaceGitignore,
  createWorkspaceReadme,
} from '../../vscode/projectInitializer';

export class SeedProjectRepository implements ISeedProjectRepository {
  public async readSeedFile(seedUri: vscode.Uri): Promise<Uint8Array> {
    return vscode.workspace.fs.readFile(seedUri);
  }

  public async inspectCreateTarget(root: vscode.Uri): Promise<{
    readonly hasMetadata: boolean;
    readonly hasProject: boolean;
  }> {
    const paths = getStoryboardProjectPaths(root);
    const [hasMetadata, hasProject] = await Promise.all([
      uriExists(paths.metadataDirectory),
      uriExists(paths.projectJson),
    ]);

    return { hasMetadata, hasProject };
  }

  public async findExistingRelativePaths(
    root: vscode.Uri,
    entries: readonly SeedFileWriteEntry[],
  ): Promise<readonly string[]> {
    const existing: string[] = [];
    for (const entry of entries) {
      if (await uriExists(this.uriForRelativeProjectPath(root, entry.relativePath))) {
        existing.push(entry.relativePath);
      }
    }

    return existing;
  }

  public async writeCreatedProject(
    root: vscode.Uri,
    seed: DecodedSeedContent,
    entries: readonly SeedFileWriteEntry[],
    logger: StoryboardLogger,
  ): Promise<void> {
    const paths = getStoryboardProjectPaths(root);
    await createStoryboardDirectories(paths);
    await this.writePlanEntries(root, entries, logger);
    await ensureWorkspaceGitignore(paths.gitignore);
    await this.writeReadmeIfMissing(paths.readme, seed.project.name);
  }

  public async loadSyncSource(
    root: vscode.Uri,
    entries: readonly SeedFileWriteEntry[],
  ): Promise<SeedSyncSource> {
    const paths = getStoryboardProjectPaths(root);
    const [characterFileNames, backgroundFileNames, sceneFileNames, existingContentByRelativePath] =
      await Promise.all([
        readDirectoryFileNamesOnly(paths.characterDirectory),
        readDirectoryFileNamesOnly(paths.backgroundDirectory),
        readDirectoryFileNamesOnly(paths.sceneDirectory),
        this.readExistingContentByRelativePath(root, entries),
      ]);

    return {
      existingContentByRelativePath,
      existingRelativePaths: collectTrackedCardAndSceneRelativePathsFromFileNames({
        characterFileNames,
        backgroundFileNames,
        sceneFileNames,
      }),
    };
  }

  public async writeSyncedProject(
    root: vscode.Uri,
    entries: readonly SeedFileWriteEntry[],
    deletions: readonly string[],
    logger: StoryboardLogger,
  ): Promise<void> {
    const paths = getStoryboardProjectPaths(root);
    await this.writePlanEntries(root, entries, logger);
    await this.deleteRelativePaths(root, deletions);
    await ensureWorkspaceGitignore(paths.gitignore);
  }

  public async readWorkspaceContent(root: vscode.Uri): Promise<WorkspaceContent> {
    return readParsedSeedEnvelopeFromWorkspaceRoot(root);
  }

  public async writeSeedFile(seedUri: vscode.Uri, content: Uint8Array): Promise<void> {
    await vscode.workspace.fs.writeFile(seedUri, content);
  }

  private uriForRelativeProjectPath(root: vscode.Uri, relativePath: string): vscode.Uri {
    return vscode.Uri.joinPath(root, ...relativePath.split('/').filter((segment) => segment));
  }

  private async readExistingContentByRelativePath(
    root: vscode.Uri,
    entries: readonly SeedFileWriteEntry[],
  ): Promise<Map<string, string>> {
    const contentByRelativePath = new Map<string, string>();
    for (const entry of entries) {
      const relativePath = normalizeRelativePath(entry.relativePath);
      const target = this.uriForRelativeProjectPath(root, relativePath);
      if (await uriExists(target)) {
        const bytes = await vscode.workspace.fs.readFile(target);
        contentByRelativePath.set(relativePath, new TextDecoder().decode(bytes));
      }
    }

    return contentByRelativePath;
  }

  private async writePlanEntries(
    root: vscode.Uri,
    entries: readonly SeedFileWriteEntry[],
    logger: StoryboardLogger,
  ): Promise<void> {
    const writtenRelativePaths: string[] = [];
    for (const entry of entries) {
      try {
        await vscode.workspace.fs.writeFile(
          this.uriForRelativeProjectPath(root, entry.relativePath),
          new TextEncoder().encode(entry.content),
        );
        writtenRelativePaths.push(entry.relativePath);
      } catch (error) {
        logger.error(
          `Seed 파일 쓰기가 중단되었습니다. 이미 반영된 경로 (${writtenRelativePaths.length}개): ${writtenRelativePaths.join(', ')}`,
          error,
        );
        throw new SeedWriteAbortedError('Seed 파일 쓰기가 중단되었습니다.', writtenRelativePaths, {
          cause: error,
        });
      }
    }
  }

  private async deleteRelativePaths(
    root: vscode.Uri,
    relativePaths: readonly string[],
  ): Promise<void> {
    for (const relativePath of relativePaths) {
      const target = this.uriForRelativeProjectPath(root, relativePath);
      if (await uriExists(target)) await vscode.workspace.fs.delete(target);
    }
  }

  private async writeReadmeIfMissing(readmeUri: vscode.Uri, projectName: string): Promise<void> {
    if (await uriExists(readmeUri)) return;

    await vscode.workspace.fs.writeFile(
      readmeUri,
      new TextEncoder().encode(createWorkspaceReadme(projectName)),
    );
  }
}
