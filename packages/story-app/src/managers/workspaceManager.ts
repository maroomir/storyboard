import {
  ChapterMemoryAuditor,
  ProjectRepository,
  StoryMemoryAuditor,
  WorkspaceInitializer,
  type ChapterMemoryAudit,
  type CreateWorkspaceRequest,
  type CreateWorkspaceResult,
  type IFileSystem,
  type IStoryboardLogger,
  type StoryMemoryAudit,
  type WorkspaceCards,
  type WorkspaceScenes,
  type ChapterSummaryLedger,
  SceneRenumberer,
  type SceneRenameJournal,
  type WorkspaceCaches,
} from '@storyboard/story-engine';
import type { ConfigBridge } from '@storyboard/story-ai';
import {
  getStoryboardProjectPaths,
  type StoryboardProject,
  type StoryboardProjectPaths,
  type StoryUri,
} from '@storyboard/story-model';
import { loadResourceOverrides, type ResourceOverrideReport } from '#app/resourceOverrides';
import type { RunGate } from '#app/runGate';

export interface WorkspaceManagerDependencies {
  readonly fileSystem: IFileSystem;
  readonly configBridge: ConfigBridge;
  readonly resourceRoots: readonly StoryUri[];
  readonly runGate: Pick<RunGate, 'describeHolder'>;
  readonly logger: IStoryboardLogger;
  readonly cards: WorkspaceCards;
  readonly scenes: WorkspaceScenes;
  readonly summaries: ChapterSummaryLedger;
  readonly caches: WorkspaceCaches;
}

export interface WorkspaceRepairResult {
  readonly addedAgentGuides: readonly string[];
  readonly sealedSceneOrders: readonly number[];
  readonly hasResumedSceneRenumbering: boolean;
  readonly reassignedPaths: readonly string[];
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
    const hasResumedSceneRenumbering: boolean = await this.createSceneRenumberer().resume(
      workspaceRoot,
    );
    const reassignedPaths: readonly string[] = await this.deps.cards.reassignCopiedIds(workspaceRoot);
    const addedAgentGuides: string[] = await initializer.writeAgentGuidesIfMissing(paths);
    const project: StoryboardProject | undefined = await this.readProject(paths).catch(
      () => undefined,
    );
    const sealedSceneOrders: readonly number[] =
      project === undefined
        ? nothingSealedWhileTheProjectIsUnreadable
        : await this.createStoryMemoryAuditor(paths, project).seal();

    return { addedAgentGuides, sealedSceneOrders, hasResumedSceneRenumbering, reassignedPaths };
  }

  public findUnfinishedSceneRenumbering(
    workspaceRoot: StoryUri,
  ): Promise<SceneRenameJournal | undefined> {
    return this.createSceneRenumberer().findUnfinished(workspaceRoot);
  }

  private createSceneRenumberer(): SceneRenumberer {
    return new SceneRenumberer({
      fileSystem: this.deps.fileSystem,
      caches: this.deps.caches,
      scenes: this.deps.scenes,
    });
  }

  public async prepare(_workspaceRoot: StoryUri): Promise<ResourceOverrideReport> {
    return await loadResourceOverrides(this.deps.fileSystem, this.deps.resourceRoots);
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
      scenes: this.deps.scenes,
      summaries: this.deps.summaries,
      paths: getStoryboardProjectPaths(workspaceRoot),
    }).audit();
  }

  private createInitializer(): WorkspaceInitializer {
    return new WorkspaceInitializer(this.deps.fileSystem, this.deps.cards);
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
      cards: this.deps.cards,
      scenes: this.deps.scenes,
      summaries: this.deps.summaries,
      paths,
      format: project.format,
      sceneBreakJoiner: this.deps.configBridge.getDraftSceneBreakSeparator(),
    });
  }
}
