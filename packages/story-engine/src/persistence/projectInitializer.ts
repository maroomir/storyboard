import type { StoryUri } from '@storyboard/story-format';
import type { StoryboardProjectPaths } from '#engine/paths/projectPaths';
import type { IFileSystem } from '#engine/ports/fileSystem';

const STORYBOARD_GITIGNORE_BLOCK = `
# Storyboard generated files
.storyboard/cache/
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
  if (!(await fs.exists(gitignoreUri))) {
    await fs.writeFile(
      gitignoreUri,
      new TextEncoder().encode(STORYBOARD_GITIGNORE_BLOCK.trimStart()),
    );
    return;
  }

  const current = new TextDecoder().decode(await fs.readFile(gitignoreUri));
  const separator = current.endsWith('\n') || current.length === 0 ? '' : '\n';

  if (!current.includes('# Storyboard generated files')) {
    await fs.writeFile(
      gitignoreUri,
      new TextEncoder().encode(`${current}${separator}${STORYBOARD_GITIGNORE_BLOCK}`),
    );
    return;
  }

  // NOTE: 마커가 있다는 것만으로 넘어가면 0.8 이전 워크스페이스에 `manuscript/`가 영영 추가되지
  // 않아 생성물이 통째로 커밋 대상에 남는다. 빠진 항목만 이어 붙인다.
  const existing = new Set(current.split('\n').map((line) => line.trim()));
  const missing = STORYBOARD_GITIGNORE_BLOCK.split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#') && !existing.has(line));

  if (missing.length === 0) {
    return;
  }

  await fs.writeFile(
    gitignoreUri,
    new TextEncoder().encode(`${current}${separator}${missing.join('\n')}\n`),
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
- \`.storyboard/memory/\`: 재생성할 수 없는 AI 기억 (이야기 상태, 페르소나, 챕터 요약)
`;
}
