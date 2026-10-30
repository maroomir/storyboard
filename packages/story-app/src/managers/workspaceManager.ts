import {
  ChapterMemoryAuditor,
  ProjectRepository,
  StoryMemoryAuditor,
  WorkspaceInitializer,
  type ChapterMemoryAudit,
  type CreateWorkspaceRequest,
  type CreateWorkspaceResult,
  type IFileSystem,
  type MemoryMigrationResult,
  type StoryMemoryAudit,
} from '@storyboard/story-engine';
import type { ConfigBridge } from '@storyboard/story-ai';
import {
  getStoryboardProjectPaths,
  type StoryboardProject,
  type StoryboardProjectPaths,
  type StoryUri,
} from '@storyboard/story-model';
import { loadResourceOverrides, type ResourceOverrideReport } from '#app/resourceOverrides';

export interface WorkspaceManagerDependencies {
  readonly fileSystem: IFileSystem;
  readonly configBridge: ConfigBridge;
  readonly resourceRoots: readonly StoryUri[];
}

export interface WorkspaceRepairResult {
  readonly addedAgentGuides: readonly string[];
  readonly sealedSceneOrders: readonly number[];
}

const nothingSealedWhileTheProjectIsUnreadable: readonly number[] = [];

export class WorkspaceManager {
  public constructor(private readonly deps: WorkspaceManagerDependencies) {}

  public create(request: CreateWorkspaceRequest): Promise<CreateWorkspaceResult> {
    return this.createInitializer().createWorkspace(request);
  }

  public async repair(workspaceRoot: StoryUri): Promise<WorkspaceRepairResult> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
    const initializer: WorkspaceInitializer = this.createInitializer();

    await initializer.createDirectories(paths);
    await initializer.ensureGitignore(paths.gitignore);
    const addedAgentGuides: string[] = await initializer.writeAgentGuidesIfMissing(paths);
    const project: StoryboardProject | undefined = await this.readProject(paths).catch(
      () => undefined,
    );
    const sealedSceneOrders: readonly number[] =
      project === undefined
        ? nothingSealedWhileTheProjectIsUnreadable
        : await this.createStoryMemoryAuditor(paths, project).seal();

    return { addedAgentGuides, sealedSceneOrders };
  }

  public async prepare(workspaceRoot: StoryUri): Promise<ResourceOverrideReport> {
    await this.migrateLegacyMemory(workspaceRoot);

    return await loadResourceOverrides(this.deps.fileSystem, this.deps.resourceRoots);
  }

  public migrateLegacyMemory(workspaceRoot: StoryUri): Promise<MemoryMigrationResult> {
    return this.createInitializer().migrateLegacyMemory(getStoryboardProjectPaths(workspaceRoot));
  }

  public async auditStoryState(workspaceRoot: StoryUri): Promise<StoryMemoryAudit> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);

    return await this.createStoryMemoryAuditor(paths, await this.readProject(paths)).audit();
  }

  public async resealStoryState(
    workspaceRoot: StoryUri,
    sceneOrders?: readonly number[],
  ): Promise<readonly number[]> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);

    return await this.createStoryMemoryAuditor(paths, await this.readProject(paths)).reseal(
      sceneOrders,
    );
  }

  public auditChapterMemory(workspaceRoot: StoryUri): Promise<ChapterMemoryAudit> {
    return new ChapterMemoryAuditor({
      fileSystem: this.deps.fileSystem,
      paths: getStoryboardProjectPaths(workspaceRoot),
    }).audit();
  }

  private createInitializer(): WorkspaceInitializer {
    return new WorkspaceInitializer(this.deps.fileSystem);
  }

  private readProject(paths: StoryboardProjectPaths): Promise<StoryboardProject> {
    return new ProjectRepository(this.deps.fileSystem).read(paths.projectJson);
  }

  private createStoryMemoryAuditor(
    paths: StoryboardProjectPaths,
    project: StoryboardProject,
  ): StoryMemoryAuditor {
    return new StoryMemoryAuditor({
      fileSystem: this.deps.fileSystem,
      paths,
      format: project.format,
      sceneBreakJoiner: this.deps.configBridge.getDraftSceneBreakSeparator(),
    });
  }
}
