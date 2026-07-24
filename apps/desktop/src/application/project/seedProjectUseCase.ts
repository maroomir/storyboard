import type * as vscode from 'vscode';

import type { StoryboardLogger } from '../../infrastructure/vscode/logger';
import {
  buildSeedWritePlan,
  type SeedFileWriteEntry,
} from '../../infrastructure/seedcoat/seedImport';
import type {
  DecodedSeedContent,
  WorkspaceContent,
} from '../../infrastructure/seedcoat/projectAdapter';
import type { PrepareSeedSyncUseCase, PreparedSeedSync } from './prepareSeedSyncUseCase';

export type SeedCreatePreparation = {
  readonly existingRelativePaths: readonly string[];
  readonly hasMetadata: boolean;
  readonly hasProject: boolean;
  readonly plan: readonly SeedFileWriteEntry[];
};

export type SeedSyncSource = {
  readonly existingContentByRelativePath: ReadonlyMap<string, string | undefined>;
  readonly existingRelativePaths: readonly string[];
};

export interface ISeedProjectRepository {
  readSeedFile(seedUri: vscode.Uri): Promise<Uint8Array>;
  inspectCreateTarget(root: vscode.Uri): Promise<{
    readonly hasMetadata: boolean;
    readonly hasProject: boolean;
  }>;
  findExistingRelativePaths(
    root: vscode.Uri,
    entries: readonly SeedFileWriteEntry[],
  ): Promise<readonly string[]>;
  writeCreatedProject(
    root: vscode.Uri,
    seed: DecodedSeedContent,
    entries: readonly SeedFileWriteEntry[],
    logger: StoryboardLogger,
  ): Promise<void>;
  loadSyncSource(root: vscode.Uri, entries: readonly SeedFileWriteEntry[]): Promise<SeedSyncSource>;
  writeSyncedProject(
    root: vscode.Uri,
    entries: readonly SeedFileWriteEntry[],
    deletions: readonly string[],
    logger: StoryboardLogger,
  ): Promise<void>;
  readWorkspaceContent(root: vscode.Uri): Promise<WorkspaceContent>;
  writeSeedFile(seedUri: vscode.Uri, content: Uint8Array): Promise<void>;
}

export class SeedProjectUseCase {
  public constructor(
    private readonly logger: StoryboardLogger,
    private readonly prepareSeedSyncUseCase: PrepareSeedSyncUseCase,
    private readonly repository: ISeedProjectRepository,
  ) {}

  public async readSeedFile(seedUri: vscode.Uri): Promise<Uint8Array> {
    return this.repository.readSeedFile(seedUri);
  }

  public async prepareCreate(
    root: vscode.Uri,
    seed: DecodedSeedContent,
  ): Promise<SeedCreatePreparation> {
    const plan = buildSeedWritePlan(seed);
    const [target, existingRelativePaths] = await Promise.all([
      this.repository.inspectCreateTarget(root),
      this.repository.findExistingRelativePaths(root, plan),
    ]);

    return { ...target, existingRelativePaths, plan };
  }

  public async createProject(
    root: vscode.Uri,
    seed: DecodedSeedContent,
    entries: readonly SeedFileWriteEntry[],
  ): Promise<void> {
    await this.repository.writeCreatedProject(root, seed, entries, this.logger);
  }

  public async prepareSync(root: vscode.Uri, seed: DecodedSeedContent): Promise<PreparedSeedSync> {
    const plan = buildSeedWritePlan(seed);
    const source = await this.repository.loadSyncSource(root, plan);

    return this.prepareSeedSyncUseCase.execute({ ...source, seed });
  }

  public async syncProject(root: vscode.Uri, prepared: PreparedSeedSync): Promise<void> {
    await this.repository.writeSyncedProject(root, prepared.plan, prepared.deletions, this.logger);
  }

  public async readWorkspaceContent(root: vscode.Uri): Promise<WorkspaceContent> {
    return this.repository.readWorkspaceContent(root);
  }

  public async writeSeedFile(seedUri: vscode.Uri, content: Uint8Array): Promise<void> {
    await this.repository.writeSeedFile(seedUri, content);
  }
}
