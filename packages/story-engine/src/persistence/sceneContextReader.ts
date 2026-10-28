import {
  createEmptyBible,
  extractDraftBody,
  formatBibleFactLines,
  formatStoryStateForPrompt,
  isBackgroundCard,
  isIgnoredSampleCardFileName,
  isStaleChapterSection,
  parseSceneCard,
  parseSceneFileName,
  readBibleFile,
  readCardFile,
  readStoryState,
  resolveSceneBackground,
  resolveSceneCharacters,
  selectCharacterKnowledge,
  selectCharacterRelations,
  selectInjectedFacts,
  stripForeignScript,
} from '@storyboard/story-model';
import type {
  BackgroundCard,
  BibleFact,
  BibleFactSubject,
  CharacterCard,
  NarrativeContext,
  NarrativeContextOptions,
  SceneContext,
  SceneContextWorkspacePaths,
  SceneFile,
  SceneFileNameParts,
  StoryBible,
  StoryboardCard,
  StoryState,
  StoryUri,
} from '@storyboard/story-model';
import type { FileSystemDirectoryEntry, IFileSystem } from '#engine/ports/fileSystem';

const summaryContextBudget: number = 8000;
const previousDraftTailLength: number = 1000;

function isWorkingCardFileName(name: string): boolean {
  return name.endsWith('.card') && !isIgnoredSampleCardFileName(name);
}

function dropStaleChapters(content: string): string | undefined {
  if (content.length === 0) {
    return undefined;
  }

  const [preamble, ...chapters] = content.split(/^(?=## )/m);
  const fresh: string[] = chapters.filter((chapter) => !isStaleChapterSection(chapter));

  if (chapters.length > 0 && fresh.length === 0) {
    return undefined;
  }

  return [preamble ?? '', ...fresh].join('').trim();
}

function joinSections(sections: readonly string[]): string {
  return sections.join('').trim();
}

function firstLines(section: string): string {
  const lines: string[] = section.split('\n');
  const heading: string = lines[0] ?? '';
  const summary: string = lines.slice(1).find((line) => line.trim().length > 0) ?? '';

  return `${heading}\n${summary.trim()}\n\n`;
}

function boundSummary(content: string): string {
  const trimmed: string = content.trim();

  if (trimmed.length <= summaryContextBudget) {
    return trimmed;
  }

  const [preamble, ...chapters] = trimmed.split(/^(?=## )/m);
  const sections: string[] = [preamble ?? '', ...chapters];

  for (
    let index: number = 1;
    index < sections.length && joinSections(sections).length > summaryContextBudget;
    index += 1
  ) {
    sections[index] = firstLines(sections[index] ?? '');
  }

  const compressed: string = joinSections(sections);
  return compressed.length <= summaryContextBudget
    ? compressed
    : compressed.slice(-summaryContextBudget).trim();
}

function sceneSubjects(context: SceneContext): BibleFactSubject[] {
  const subjects: BibleFactSubject[] = context.characters.map((character) => ({
    kind: 'character',
    id: character.id,
  }));

  if (context.background) {
    subjects.push({ kind: 'background', id: context.background.id });
  }

  return subjects;
}

function composeNarrativePrompt(
  factLines: readonly string[],
  storyState: string | undefined,
  previousContext: string | undefined,
): string | undefined {
  const sections: string[] = [];

  if (storyState) {
    sections.push(storyState);
  }

  if (factLines.length > 0) {
    sections.push(
      [
        '[설정 메모]',
        ...factLines.map((line) => `- ${line}`),
        '(위 설정은 작가 참고용 배경지식이다. 인물이 아직 모르거나 겪지 않은 사실을 대사·사건으로 드러내지 마라.)',
      ].join('\n'),
    );
  }

  const trimmedPrevious: string | undefined = previousContext?.trim();
  if (trimmedPrevious) {
    sections.push(`[이전 장면]\n${trimmedPrevious}`);
  }

  return sections.length > 0 ? sections.join('\n\n') : undefined;
}

function selectSceneCharacterRelations(
  ledger: StoryState,
  context: SceneContext,
): ReadonlyMap<string, readonly string[]> | undefined {
  const relations: Map<string, readonly string[]> = new Map<string, readonly string[]>();

  for (const character of context.characters) {
    const changes: string[] = selectCharacterRelations(
      ledger,
      { id: character.id, names: [character.name, ...(character.aliases ?? [])] },
      context.scene.order,
    );
    if (changes.length > 0) {
      relations.set(character.name, changes);
    }
  }

  return relations.size > 0 ? relations : undefined;
}

function selectSceneCharacterKnowledge(
  ledger: StoryState,
  context: SceneContext,
): ReadonlyMap<string, readonly string[]> | undefined {
  const knowledge: Map<string, readonly string[]> = new Map<string, readonly string[]>();

  for (const character of context.characters) {
    const known: string[] = selectCharacterKnowledge(
      ledger,
      character.id,
      context.scene.order,
      context.scene.body,
    );
    if (known.length > 0) {
      knowledge.set(character.name, known);
    }
  }

  return knowledge.size > 0 ? knowledge : undefined;
}

export class SceneContextReader {
  public constructor(private readonly fileSystem: IFileSystem) {}

  public async build(paths: SceneContextWorkspacePaths, scene: SceneFile): Promise<SceneContext> {
    const [allCharacters, allBackgrounds] = await Promise.all([
      this.listCards(paths.characterDirectory, paths, (card) =>
        card.type === 'character' ? card : undefined,
      ),
      this.listCards(paths.backgroundDirectory, paths, (card) =>
        isBackgroundCard(card) ? card : undefined,
      ),
    ]);

    const characters: readonly CharacterCard[] = resolveSceneCharacters(scene, allCharacters);
    const background: BackgroundCard | undefined = resolveSceneBackground(scene, allBackgrounds);

    return { scene, characters, background };
  }

  public async readPrevious(
    paths: SceneContextWorkspacePaths,
    currentSceneOrder: number,
    previousSceneOrder?: number,
  ): Promise<string | undefined> {
    const previousOrder: number = previousSceneOrder ?? currentSceneOrder - 1;

    if (previousOrder < 1) {
      return undefined;
    }

    const rollingSummary: string | undefined = await this.readRollingSummary(paths);
    if (rollingSummary) {
      return rollingSummary;
    }

    return this.readPreviousDraftTail(paths, previousOrder);
  }

  public async resolveBibleFacts(
    paths: SceneContextWorkspacePaths,
    context: SceneContext,
  ): Promise<readonly BibleFact[]> {
    const bible: StoryBible = await this.readSceneBible(paths);
    const storyTimeline: ReadonlyMap<number, number> | undefined = await this.readStoryTimeline(
      paths,
      bible,
    );

    return selectInjectedFacts(
      bible,
      sceneSubjects(context),
      context.scene.body,
      context.scene.order,
      {
        ...(storyTimeline === undefined ? {} : { storyTimeline }),
      },
    );
  }

  public async buildNarrative(
    paths: SceneContextWorkspacePaths,
    context: SceneContext,
    options?: NarrativeContextOptions,
  ): Promise<NarrativeContext> {
    const rawPreviousContext: string | undefined = await this.readPrevious(
      paths,
      context.scene.order,
      options?.previousSceneOrder,
    );
    const previousContext: string | undefined =
      rawPreviousContext === undefined ? undefined : stripForeignScript(rawPreviousContext);
    const bibleFacts: readonly BibleFact[] = await this.resolveBibleFacts(paths, context);
    const ledger: StoryState | undefined = await this.readSceneStoryLedger(
      paths,
      context.scene.order,
    );
    const storyState: string | undefined =
      ledger === undefined
        ? undefined
        : formatStoryStateForPrompt(
            ledger,
            context.scene.order,
            context.scene.body,
            options?.focalFilter,
          );
    const prompt: string | undefined = composeNarrativePrompt(
      formatBibleFactLines(context, bibleFacts),
      storyState,
      previousContext,
    );
    const characterKnowledge: ReadonlyMap<string, readonly string[]> | undefined =
      ledger === undefined ? undefined : selectSceneCharacterKnowledge(ledger, context);
    const characterRelations: ReadonlyMap<string, readonly string[]> | undefined =
      ledger === undefined ? undefined : selectSceneCharacterRelations(ledger, context);

    return {
      bibleFacts,
      prompt,
      ...(characterKnowledge === undefined ? {} : { characterKnowledge }),
      ...(characterRelations === undefined ? {} : { characterRelations }),
    };
  }

  private async listCards<T extends StoryboardCard>(
    directory: StoryUri,
    paths: SceneContextWorkspacePaths,
    pick: (card: StoryboardCard) => T | undefined,
  ): Promise<readonly T[]> {
    try {
      const entries: FileSystemDirectoryEntry[] = await this.fileSystem.readDirectory(directory);
      const cardFiles: FileSystemDirectoryEntry[] = entries.filter(
        ([name, entry]) => entry.type === 'file' && isWorkingCardFileName(name),
      );

      const cards: (T | undefined)[] = await Promise.all(
        cardFiles.map(async ([name]) => {
          const uri: StoryUri = paths.joinPath(directory, name);
          try {
            return pick(await readCardFile(uri, this.fileSystem));
          } catch {
            return undefined;
          }
        }),
      );

      return cards.filter((card): card is T => card !== undefined);
    } catch {
      return [];
    }
  }

  private async readRollingSummary(paths: SceneContextWorkspacePaths): Promise<string | undefined> {
    if (!paths.chapterSummaries) {
      return undefined;
    }

    try {
      const content: string = new TextDecoder().decode(
        await this.fileSystem.readFile(paths.chapterSummaries),
      );
      const fresh: string | undefined = dropStaleChapters(content.trim());
      return fresh === undefined ? undefined : boundSummary(fresh);
    } catch {
      return undefined;
    }
  }

  private async readPreviousDraftTail(
    paths: SceneContextWorkspacePaths,
    previousOrder: number,
  ): Promise<string | undefined> {
    try {
      const entries: FileSystemDirectoryEntry[] = await this.fileSystem.readDirectory(
        paths.draftDirectory,
      );
      const draftFiles: FileSystemDirectoryEntry[] = entries.filter(
        ([name, entry]) => entry.type === 'file' && name.endsWith('.md'),
      );

      const previousFileName: FileSystemDirectoryEntry | undefined = draftFiles.find(([name]) => {
        const match: RegExpExecArray | null = /^(\d+)-/.exec(name);
        return match && Number.parseInt(match[1] as string, 10) === previousOrder;
      });

      if (!previousFileName) {
        return undefined;
      }

      const uri: StoryUri = paths.joinPath(paths.draftDirectory, previousFileName[0]);
      const body: string = extractDraftBody(
        new TextDecoder().decode(await this.fileSystem.readFile(uri)),
      );

      const lastCharacters: string = body.slice(-previousDraftTailLength).trim();
      return lastCharacters.length > 0 ? lastCharacters : undefined;
    } catch {
      return undefined;
    }
  }

  private async readSceneBible(paths: SceneContextWorkspacePaths): Promise<StoryBible> {
    if (!paths.bibleCanon) {
      return createEmptyBible();
    }

    try {
      return await readBibleFile(paths.bibleCanon, this.fileSystem);
    } catch {
      return createEmptyBible();
    }
  }

  private async readStoryTimeline(
    paths: SceneContextWorkspacePaths,
    bible: StoryBible,
  ): Promise<ReadonlyMap<number, number> | undefined> {
    const usesRanges: boolean = bible.facts.some(
      (fact) => fact.validFrom !== undefined || fact.validUntil !== undefined,
    );

    if (!usesRanges || !paths.sceneDirectory) {
      return undefined;
    }

    const sceneDirectory: StoryUri = paths.sceneDirectory;
    const timeline: Map<number, number> = new Map<number, number>();
    let entries: FileSystemDirectoryEntry[];

    try {
      entries = await this.fileSystem.readDirectory(sceneDirectory);
    } catch {
      return undefined;
    }

    await Promise.all(
      entries.map(async ([fileName, entry]) => {
        const parts: SceneFileNameParts | undefined =
          entry.type === 'file' ? parseSceneFileName(fileName) : undefined;

        if (parts === undefined) {
          return;
        }

        try {
          const raw: string = new TextDecoder().decode(
            await this.fileSystem.readFile(paths.joinPath(sceneDirectory, fileName)),
          );
          const storyTime: number | undefined = parseSceneCard(raw).storyTime;

          if (storyTime !== undefined) {
            timeline.set(parts.order, storyTime);
          }
        } catch {
          return;
        }
      }),
    );

    return timeline.size > 0 ? timeline : undefined;
  }

  private async readSceneStoryLedger(
    paths: SceneContextWorkspacePaths,
    currentSceneOrder: number,
  ): Promise<StoryState | undefined> {
    if (!paths.storyState || currentSceneOrder <= 1) {
      return undefined;
    }

    return await readStoryState(paths.storyState, this.fileSystem);
  }
}
