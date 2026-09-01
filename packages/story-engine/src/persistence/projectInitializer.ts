import type { StoryUri } from '@storyboard/story-format';
import type { StoryboardProjectPaths } from '../paths/projectPaths';
import type { IFileSystem } from '../ports/fileSystem';

const STORYBOARD_GITIGNORE_BLOCK = `
# Storyboard generated files
.storyboard/cache/
draft/
.draft/
manuscript/
character/.sample.card
background/.sample.card
scene/.sample.card
`;

export async function createStoryboardDirectories(
  fs: IFileSystem,
  paths: StoryboardProjectPaths,
): Promise<void> {
  await Promise.all([
    fs.createDirectory(paths.sceneCacheDirectory),
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
  if (!(await fs.exists(gitignoreUri))) {
    await fs.writeFile(
      gitignoreUri,
      new TextEncoder().encode(STORYBOARD_GITIGNORE_BLOCK.trimStart()),
    );
    return;
  }

  const current = new TextDecoder().decode(await fs.readFile(gitignoreUri));
  if (current.includes('# Storyboard generated files')) {
    return;
  }

  const separator = current.endsWith('\n') ? '' : '\n';
  await fs.writeFile(
    gitignoreUri,
    new TextEncoder().encode(`${current}${separator}${STORYBOARD_GITIGNORE_BLOCK}`),
  );
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
`;
}
