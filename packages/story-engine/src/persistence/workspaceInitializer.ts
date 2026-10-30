import {
  STORYBOARD_RELATIVE_PATHS,
  getStoryboardProjectPaths,
  joinStoryPath,
  mergeStoryboardGitignore,
  serializeNarratorCard,
  type NarratorCard,
  type ProjectSetting,
  type StoryboardProject,
  type StoryboardProjectPaths,
  type StoryUri,
} from '@storyboard/story-model';
import type { FileSystemDirectoryEntry, IFileSystem } from '#engine/ports/fileSystem';
import { createDefaultProjectJson } from '#engine/persistence/projectJson';
import { ProjectRepository } from '#engine/persistence/repositories/projectRepository';
import {
  createWorkspaceAgentGuide,
  workspaceClaudeGuide,
} from '#engine/persistence/workspaceAgentGuide';

export function createWorkspaceReadme(projectName: string): string {
  return `# ${projectName}

Storyboard 프로젝트 노트입니다.

## 구조

- \`.storyboard/project.json\`: 프로젝트 메타데이터
- \`character/\`: 캐릭터 카드
- \`background/\`: 배경 카드
- \`scene/\`: 사용자가 작성하는 씬 시드
- \`draft/\`: AI가 생성하는 원고 산출물
- \`.storyboard/memory/\`: 재생성할 수 없는 AI 기억 (이야기 상태, 페르소나, 챕터 요약)
`;
}

export interface CreateWorkspaceRequest {
  readonly workspaceRoot: StoryUri;
  readonly name: string;
  readonly language?: string;
  readonly setting?: ProjectSetting;
  readonly narratorCards?: readonly NarratorCard[];
}

export interface CreateWorkspaceResult {
  readonly project: StoryboardProject;
  readonly createdNarrators: readonly string[];
}

export interface MemoryMigrationResult {
  readonly movedPaths: readonly string[];
}

interface AgentGuideFile {
  readonly uri: StoryUri;
  readonly name: string;
  readonly content: string;
}

interface LegacyMemoryMove {
  readonly legacy: string;
  readonly current: string;
}

const legacyMemoryLocations: readonly LegacyMemoryMove[] = [
  { legacy: '.storyboard/cache/storyState.md', current: STORYBOARD_RELATIVE_PATHS.storyState },
  { legacy: 'manuscript/SUMMARY.md', current: STORYBOARD_RELATIVE_PATHS.chapterSummaries },
];

const legacyMemoryDirectories: readonly LegacyMemoryMove[] = [
  {
    legacy: '.storyboard/cache/dialogue',
    current: STORYBOARD_RELATIVE_PATHS.sceneDialogueDirectory,
  },
  {
    legacy: '.storyboard/cache/personas',
    current: STORYBOARD_RELATIVE_PATHS.personaMemoryDirectory,
  },
  {
    legacy: '.storyboard/cache/backgrounds',
    current: STORYBOARD_RELATIVE_PATHS.backgroundMemoryDirectory,
  },
];

function resolveRelative(workspaceRoot: StoryUri, relativePath: string): StoryUri {
  return joinStoryPath(workspaceRoot, ...relativePath.split('/'));
}

export class WorkspaceInitializer {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async createWorkspace(request: CreateWorkspaceRequest): Promise<CreateWorkspaceResult> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(request.workspaceRoot);
    const base: StoryboardProject = createDefaultProjectJson({
      name: request.name,
      ...(request.language === undefined ? {} : { language: request.language }),
    });
    const project: StoryboardProject =
      request.setting === undefined ? base : { ...base, setting: request.setting };

    await this.fileSystem.createDirectory(paths.metadataDirectory);
    await this.createDirectories(paths);
    await new ProjectRepository(this.fileSystem).write(paths.projectJson, project);
    await this.ensureGitignore(paths.gitignore);
    await this.writeReadmeIfMissing(paths.readme, project.name);
    await this.writeAgentGuidesIfMissing(paths);
    const createdNarrators: string[] = await this.writeNarratorCardsIfMissing(
      paths,
      request.narratorCards ?? [],
    );

    return { project, createdNarrators };
  }

  private async writeReadmeIfMissing(readmeUri: StoryUri, projectName: string): Promise<void> {
    if (await this.fileSystem.exists(readmeUri)) {
      return;
    }

    await this.fileSystem.writeFile(
      readmeUri,
      new TextEncoder().encode(createWorkspaceReadme(projectName)),
    );
  }

  public async createDirectories(paths: StoryboardProjectPaths): Promise<void> {
    await Promise.all([
      this.fileSystem.createDirectory(paths.sceneCacheDirectory),
      this.fileSystem.createDirectory(paths.memoryDirectory),
      this.fileSystem.createDirectory(paths.characterProfileDirectory),
      this.fileSystem.createDirectory(paths.backgroundDirectory),
      this.fileSystem.createDirectory(paths.sceneDirectory),
      this.fileSystem.createDirectory(paths.draftDirectory),
    ]);
  }

  public async ensureGitignore(gitignoreUri: StoryUri): Promise<void> {
    const current: string | undefined = (await this.fileSystem.exists(gitignoreUri))
      ? new TextDecoder().decode(await this.fileSystem.readFile(gitignoreUri))
      : undefined;
    const merged: string | undefined = mergeStoryboardGitignore(current);

    if (merged !== undefined) {
      await this.fileSystem.writeFile(gitignoreUri, new TextEncoder().encode(merged));
    }
  }

  public async writeNarratorCardsIfMissing(
    paths: StoryboardProjectPaths,
    cards: readonly NarratorCard[],
  ): Promise<string[]> {
    if (cards.length === 0) {
      return [];
    }

    await this.fileSystem.createDirectory(paths.narratorDirectory);

    const written: string[] = [];
    for (const card of cards) {
      const uri: StoryUri = joinStoryPath(paths.narratorDirectory, `${card.id}.card`);

      if (await this.fileSystem.exists(uri)) {
        continue;
      }

      await this.fileSystem.writeFile(uri, new TextEncoder().encode(serializeNarratorCard(card)));
      written.push(card.id);
    }

    return written;
  }

  public async writeAgentGuidesIfMissing(paths: StoryboardProjectPaths): Promise<string[]> {
    const guides: AgentGuideFile[] = [
      {
        uri: paths.agentGuide,
        name: STORYBOARD_RELATIVE_PATHS.agentGuide,
        content: createWorkspaceAgentGuide(),
      },
      {
        uri: paths.claudeGuide,
        name: STORYBOARD_RELATIVE_PATHS.claudeGuide,
        content: workspaceClaudeGuide,
      },
    ];
    const written: string[] = [];

    for (const guide of guides) {
      if (await this.fileSystem.exists(guide.uri)) {
        continue;
      }

      await this.fileSystem.writeFile(guide.uri, new TextEncoder().encode(guide.content));
      written.push(guide.name);
    }

    return written;
  }

  public async migrateLegacyMemory(paths: StoryboardProjectPaths): Promise<MemoryMigrationResult> {
    const workspaceRoot: StoryUri = paths.workspaceRoot;
    const movedPaths: string[] = [];

    for (const location of legacyMemoryLocations) {
      const legacyUri: StoryUri = resolveRelative(workspaceRoot, location.legacy);
      if (!(await this.fileSystem.exists(legacyUri))) {
        continue;
      }

      const currentUri: StoryUri = resolveRelative(workspaceRoot, location.current);
      if (!(await this.fileSystem.exists(currentUri))) {
        await this.fileSystem.createDirectory(paths.memoryDirectory);
        await this.fileSystem.writeFile(currentUri, await this.fileSystem.readFile(legacyUri));
        movedPaths.push(location.current);
      }

      await this.fileSystem.delete(legacyUri);
    }

    for (const location of legacyMemoryDirectories) {
      const legacyUri: StoryUri = resolveRelative(workspaceRoot, location.legacy);
      if (!(await this.fileSystem.exists(legacyUri))) {
        continue;
      }

      const currentUri: StoryUri = resolveRelative(workspaceRoot, location.current);
      movedPaths.push(...(await this.moveDirectoryFiles(legacyUri, currentUri, location.current)));
      await this.fileSystem.delete(legacyUri);
    }

    return { movedPaths };
  }

  private async moveDirectoryFiles(
    legacyUri: StoryUri,
    currentUri: StoryUri,
    currentRelativePath: string,
  ): Promise<string[]> {
    const entries: FileSystemDirectoryEntry[] = await this.fileSystem.readDirectory(legacyUri);
    const fileNames: string[] = entries
      .filter(([, stat]) => stat.type === 'file')
      .map(([name]) => name);
    if (fileNames.length === 0) {
      return [];
    }

    await this.fileSystem.createDirectory(currentUri);

    const moved: string[] = [];
    for (const fileName of fileNames) {
      const legacyFileUri: StoryUri = joinStoryPath(legacyUri, fileName);
      const targetUri: StoryUri = joinStoryPath(currentUri, fileName);

      if (!(await this.fileSystem.exists(targetUri))) {
        await this.fileSystem.writeFile(targetUri, await this.fileSystem.readFile(legacyFileUri));
        moved.push(`${currentRelativePath}/${fileName}`);
      }

      await this.fileSystem.delete(legacyFileUri);
    }

    return moved;
  }
}
