import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import {
  isLegacySceneFileName,
  STORYBOARD_RELATIVE_PATHS,
  backgroundCardRelativePath,
  characterCardRelativePath,
  draftRelativePath,
  isIgnoredSampleCardFileName,
  parseCard,
  parseCardIdFromFileName,
  parseChapterPlan,
  parseNarratorCard,
  parseScene,
  parseSceneCard,
  sceneSummaryReference,
  parseSceneStem,
  parseBible,
  sceneRelativePath,
  type ChapterPlan,
  type NarratorCard,
  type SceneFile,
  type StoryBible,
  type StoryboardCard,
  type StoryboardProject,
} from '@storyboard/story-format';

export type WorkspaceErrorCode = 'not-a-workspace' | 'unreadable' | 'invalid-project';

export class WorkspaceError extends Error {
  public constructor(
    public readonly code: WorkspaceErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

// A file read together with the hash of the exact bytes that produced it. The hash is the edit
// baseline: before writing, the store re-reads the file and refuses the write if the hash moved,
// so a Desktop save can never be clobbered by a stale in-memory snapshot.
export interface ReadFile<T> {
  readonly value: T;
  readonly relativePath: string;
  readonly contentHash: string;
}

export interface CardSummary {
  readonly id: string;
  readonly relativePath: string;
  readonly kind: 'character' | 'background';
}

export interface SceneSummary {
  readonly stem: string;
  readonly order: number;
  readonly slug: string;
  readonly relativePath: string;
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

// Reads a Storyboard workspace directly from disk. Every read goes to the filesystem — there is no
// long-lived snapshot cache, because the VSCode extension edits the same directory concurrently.
export class WorkspaceStore {
  public constructor(private readonly workspaceRoot: string) {
    if (!isAbsolute(workspaceRoot)) {
      throw new WorkspaceError(
        'not-a-workspace',
        `워크스페이스 경로는 절대 경로여야 합니다: ${workspaceRoot}`,
      );
    }
  }

  public get root(): string {
    return this.workspaceRoot;
  }

  public absolutePath(relativePath: string): string {
    return join(this.workspaceRoot, ...relativePath.split('/'));
  }

  // A directory is a Storyboard workspace when it carries the project manifest the extension
  // activates on.
  public async assertIsWorkspace(): Promise<void> {
    const projectPath = this.absolutePath(STORYBOARD_RELATIVE_PATHS.projectJson);

    try {
      const stats = await stat(projectPath);
      if (!stats.isFile()) {
        throw new WorkspaceError('not-a-workspace', `${projectPath}가 파일이 아닙니다.`);
      }
    } catch (error) {
      if (error instanceof WorkspaceError) {
        throw error;
      }
      throw new WorkspaceError(
        'not-a-workspace',
        `Storyboard 워크스페이스가 아닙니다: ${this.workspaceRoot} (.storyboard/project.json 없음)`,
        error,
      );
    }
  }

  public async readProject(): Promise<ReadFile<StoryboardProject>> {
    const relativePath = STORYBOARD_RELATIVE_PATHS.projectJson;
    const raw = await this.readText(relativePath);

    let value: StoryboardProject;
    try {
      value = JSON.parse(raw) as StoryboardProject;
    } catch (error) {
      throw new WorkspaceError('invalid-project', 'project.json을 파싱할 수 없습니다.', error);
    }

    return { value, relativePath, contentHash: hashContent(raw) };
  }

  public async listCards(): Promise<CardSummary[]> {
    const character = await this.listCardsIn(
      STORYBOARD_RELATIVE_PATHS.characterDirectory,
      'character',
    );
    const background = await this.listCardsIn(
      STORYBOARD_RELATIVE_PATHS.backgroundDirectory,
      'background',
    );

    return [...character, ...background];
  }

  public async readCard(
    kind: 'character' | 'background',
    id: string,
  ): Promise<ReadFile<StoryboardCard>> {
    const relativePath =
      kind === 'character' ? characterCardRelativePath(id) : backgroundCardRelativePath(id);
    const raw = await this.readText(relativePath);

    return { value: parseCard(raw), relativePath, contentHash: hashContent(raw) };
  }

  // 서술자 카드는 씬·장이 고르는 시점의 정본이다. 봇은 읽고 만들기만 하고, 고치는 자리는
  // 카드 에디터다.
  public async listNarrators(): Promise<NarratorCard[]> {
    const names = await this.listDirectory(STORYBOARD_RELATIVE_PATHS.narratorDirectory);
    const narrators: NarratorCard[] = [];

    for (const name of names) {
      if (!name.endsWith('.card') || name.startsWith('.')) {
        continue;
      }

      try {
        narrators.push(
          parseNarratorCard(
            await this.readText(`${STORYBOARD_RELATIVE_PATHS.narratorDirectory}/${name}`),
          ),
        );
      } catch {
        continue;
      }
    }

    return narrators.sort((left, right) => left.id.localeCompare(right.id));
  }

  public async listScenes(): Promise<SceneSummary[]> {
    const names = await this.listDirectory(STORYBOARD_RELATIVE_PATHS.sceneDirectory);
    const scenes: SceneSummary[] = [];

    for (const name of names) {
      if (!name.endsWith('.card') || name.startsWith('.')) {
        continue;
      }

      const parts = parseSceneStem(name.slice(0, -'.card'.length));
      if (!parts) {
        continue;
      }

      scenes.push({
        stem: `${parts.orderText}-${parts.slug}`,
        order: parts.order,
        slug: parts.slug,
        relativePath: `${STORYBOARD_RELATIVE_PATHS.sceneDirectory}/${name}`,
      });
    }

    return scenes.sort((left, right) => left.order - right.order);
  }

  // 마이그레이션 전용 스캔: 구형 씬 텍스트(.txt)는 목록·생성 경로에서 제외되므로 여기서만 보인다.
  public async listLegacySceneTextFileNames(): Promise<string[]> {
    const names = await this.listDirectory(STORYBOARD_RELATIVE_PATHS.sceneDirectory);
    return names.filter((name) => isLegacySceneFileName(name)).sort();
  }

  public async readScene(sceneStem: string): Promise<ReadFile<SceneFile>> {
    const relativePath = sceneRelativePath(sceneStem);
    const raw = await this.readText(relativePath);
    const summaryText = await this.readSceneSummaryText(parseSceneCard(raw).summary);

    return {
      value: parseScene(raw, `${sceneStem}.card`, summaryText),
      relativePath,
      contentHash: hashContent(raw),
    };
  }

  // summary 가 `<stem>.summary.md` 참조면 그 파일이 창작자의 사건 메모다. 파일이 아직 없으면 비어 있는 것으로 본다.
  public async readSceneSummaryText(summary: string | undefined): Promise<string | undefined> {
    const summaryFileName = sceneSummaryReference(summary);

    if (summaryFileName === undefined) {
      return undefined;
    }

    try {
      return await this.readText(`${STORYBOARD_RELATIVE_PATHS.sceneDirectory}/${summaryFileName}`);
    } catch {
      return '';
    }
  }

  public async readDraft(sceneStem: string): Promise<ReadFile<string> | undefined> {
    const relativePath = draftRelativePath(sceneStem);

    try {
      const raw = await this.readText(relativePath);
      return { value: raw, relativePath, contentHash: hashContent(raw) };
    } catch {
      return undefined;
    }
  }

  public async readBible(): Promise<ReadFile<StoryBible> | undefined> {
    const relativePath = STORYBOARD_RELATIVE_PATHS.bibleCanon;

    try {
      const raw = await this.readText(relativePath);
      return { value: parseBible(raw), relativePath, contentHash: hashContent(raw) };
    } catch {
      return undefined;
    }
  }

  public async readChapterPlan(): Promise<ReadFile<ChapterPlan> | undefined> {
    const relativePath = STORYBOARD_RELATIVE_PATHS.outlineChapters;

    try {
      const raw = await this.readText(relativePath);
      return { value: parseChapterPlan(raw), relativePath, contentHash: hashContent(raw) };
    } catch {
      return undefined;
    }
  }

  public async readSynopsis(): Promise<ReadFile<string> | undefined> {
    const relativePath = STORYBOARD_RELATIVE_PATHS.outlineSynopsis;

    try {
      const raw = await this.readText(relativePath);
      return { value: raw, relativePath, contentHash: hashContent(raw) };
    } catch {
      return undefined;
    }
  }

  public async readText(relativePath: string): Promise<string> {
    try {
      return await readFile(this.absolutePath(relativePath), 'utf8');
    } catch (error) {
      throw new WorkspaceError('unreadable', `파일을 읽을 수 없습니다: ${relativePath}`, error);
    }
  }

  private async listCardsIn(
    directory: string,
    kind: 'character' | 'background',
  ): Promise<CardSummary[]> {
    const names = await this.listDirectory(directory);
    const cards: CardSummary[] = [];

    for (const name of names) {
      if (isIgnoredSampleCardFileName(name)) {
        continue;
      }

      const id = parseCardIdFromFileName(name);
      if (id === undefined) {
        continue;
      }

      cards.push({ id, kind, relativePath: `${directory}/${name}` });
    }

    return cards.sort((left, right) => left.id.localeCompare(right.id));
  }

  public listDirectoryNames(relativePath: string): Promise<string[]> {
    return this.listDirectory(relativePath);
  }

  private async listDirectory(relativePath: string): Promise<string[]> {
    try {
      return await readdir(this.absolutePath(relativePath));
    } catch {
      return [];
    }
  }
}
