import {
  joinStoryPath,
  mergeStoryboardGitignore,
  serializeNarratorCard,
  type NarratorCard,
  type ProjectSetting,
  type StoryboardProject,
  type StoryUri,
} from '@storyboard/story-model';
import { getStoryboardProjectPaths, type StoryboardProjectPaths } from '#engine/paths/projectPaths';
import type { IFileSystem } from '#engine/ports/fileSystem';
import { createDefaultProjectJson, writeProjectJson } from '#engine/persistence/projectJson';
import { writeWorkspaceAgentGuidesIfMissing } from '#engine/persistence/workspaceAgentGuide';

export async function createStoryboardDirectories(
  fs: IFileSystem,
  paths: StoryboardProjectPaths,
): Promise<void> {
  await Promise.all([
    fs.createDirectory(paths.sceneCacheDirectory),
    fs.createDirectory(paths.memoryDirectory),
    fs.createDirectory(paths.characterProfileDirectory),
    fs.createDirectory(paths.backgroundDirectory),
    fs.createDirectory(paths.sceneDirectory),
    fs.createDirectory(paths.draftDirectory),
  ]);
}

export async function ensureWorkspaceGitignore(
  fs: IFileSystem,
  gitignoreUri: StoryUri,
): Promise<void> {
  const current = (await fs.exists(gitignoreUri))
    ? new TextDecoder().decode(await fs.readFile(gitignoreUri))
    : undefined;
  const merged = mergeStoryboardGitignore(current);

  if (merged !== undefined) {
    await fs.writeFile(gitignoreUri, new TextEncoder().encode(merged));
  }
}

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
  readonly fileSystem: IFileSystem;
  readonly workspaceRoot: StoryUri;
  readonly name: string;
  readonly language?: string;
  readonly setting?: ProjectSetting;
  // Narrator cards a composition preset asked for alongside the contract.
  readonly narratorCards?: readonly NarratorCard[];
}

export interface CreateWorkspaceResult {
  readonly project: StoryboardProject;
  readonly createdNarrators: readonly string[];
}

// Everything a new workspace needs on disk, in the order that keeps a first commit clean: the
// ignore block exists before any generated file could. Creating the git repository is the host's
// business, because only the host knows whether git is there and how to run it.
export async function createWorkspace(request: CreateWorkspaceRequest): Promise<CreateWorkspaceResult> {
  const { fileSystem } = request;
  const paths = getStoryboardProjectPaths(request.workspaceRoot);
  const base = createDefaultProjectJson({
    name: request.name,
    ...(request.language === undefined ? {} : { language: request.language }),
  });
  const project = request.setting === undefined ? base : { ...base, setting: request.setting };

  await fileSystem.createDirectory(paths.metadataDirectory);
  await createStoryboardDirectories(fileSystem, paths);
  await writeProjectJson(fileSystem, paths.projectJson, project);
  await ensureWorkspaceGitignore(fileSystem, paths.gitignore);
  await fileSystem.writeFile(paths.readme, new TextEncoder().encode(createWorkspaceReadme(project.name)));
  await writeWorkspaceAgentGuidesIfMissing(fileSystem, paths);
  const createdNarrators = await writeNarratorCardsIfMissing(
    fileSystem,
    paths,
    request.narratorCards ?? [],
  );

  return { project, createdNarrators };
}

// 이미 있는 서술자는 손대지 않는다. 프리셋을 다시 돌렸다고 작가가 고친 목소리를 잃으면 안 된다.
export async function writeNarratorCardsIfMissing(
  fileSystem: IFileSystem,
  paths: StoryboardProjectPaths,
  cards: readonly NarratorCard[],
): Promise<string[]> {
  if (cards.length === 0) {
    return [];
  }

  await fileSystem.createDirectory(paths.narratorDirectory);

  const written: string[] = [];
  for (const card of cards) {
    const uri = joinStoryPath(paths.narratorDirectory, `${card.id}.card`);

    if (await fileSystem.exists(uri)) {
      continue;
    }

    await fileSystem.writeFile(uri, new TextEncoder().encode(serializeNarratorCard(card)));
    written.push(card.id);
  }

  return written;
}
