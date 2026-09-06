import { mergeStoryboardGitignore, type StoryUri } from '@storyboard/story-format';
import type { StoryboardProjectPaths } from '#engine/paths/projectPaths';
import type { IFileSystem } from '#engine/ports/fileSystem';

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
