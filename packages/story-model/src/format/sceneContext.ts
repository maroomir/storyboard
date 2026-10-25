import type { StoryUri } from './storyUri';
import {
  characterMatchTokens,
  isBackgroundCard,
  type BackgroundCard,
  type CharacterCard,
  type StoryboardCard,
} from './card';
import { parseSceneFileName, type SceneFile, type SceneFileNameParts } from './scene';
import { parseSceneCard } from './files/scene';
import { readCardFile } from './files/card';
import { readBibleFile } from './files/bible';
import { extractDraftBody } from './files/draft';
import {
  createEmptyBible,
  revealKnownBy,
  selectInjectedFacts,
  type BibleFact,
  type BibleFactSubject,
  type StoryBible,
} from './bible';
import { isStaleChapterSection } from './chapterSummaryMarks';
import { isIgnoredSampleCardFileName } from './sampleCard';
import { detectCharactersInText } from './characterDetector';
import {
  formatStoryStateForPrompt,
  readStoryState,
  selectCharacterKnowledge,
  selectCharacterRelations,
  type StoryState,
  type StoryStateFocalFilter,
} from './storyState';
import { stripForeignScript } from './foreignScript';

export interface SceneContextWorkspacePaths {
  readonly characterDirectory: StoryUri;
  readonly sceneDirectory?: StoryUri;
  readonly backgroundDirectory: StoryUri;
  readonly draftDirectory: StoryUri;
  readonly bibleCanon?: StoryUri;
  readonly chapterSummaries?: StoryUri;
  readonly storyState?: StoryUri;
  readonly joinPath: (base: StoryUri, ...pathSegments: string[]) => StoryUri;
}

export type WorkspaceDirectoryEntry = [string, { type: 'file' | 'directory' }];

export interface SceneContextWorkspaceFileSystem {
  readonly readFile: (uri: StoryUri) => PromiseLike<Uint8Array>;
  readonly writeFile: (uri: StoryUri, content: Uint8Array) => PromiseLike<void>;
  readonly readDirectory: (uri: StoryUri) => PromiseLike<WorkspaceDirectoryEntry[]>;
}

export interface SceneContext {
  readonly scene: SceneFile;
  readonly characters: readonly CharacterCard[];
  readonly background?: BackgroundCard;
}

export async function buildSceneContext(
  paths: SceneContextWorkspacePaths,
  scene: SceneFile,
  fileSystem: SceneContextWorkspaceFileSystem,
): Promise<SceneContext> {
  const [allCharacters, allBackgrounds] = await Promise.all([
    listProjectCharacters(paths, fileSystem),
    listProjectBackgrounds(paths, fileSystem),
  ]);

  const characters: readonly CharacterCard[] = resolveSceneCharacters(scene, allCharacters);
  const background: BackgroundCard | undefined = resolveSceneBackground(scene, allBackgrounds);

  return {
    scene,
    characters,
    background,
  };
}

const summaryContextBudget: number = 8000;

export async function readPreviousSceneContext(
  paths: SceneContextWorkspacePaths,
  currentSceneOrder: number,
  fileSystem: SceneContextWorkspaceFileSystem,
  previousSceneOrder?: number,
): Promise<string | undefined> {
  const previousOrder: number = previousSceneOrder ?? currentSceneOrder - 1;

  if (previousOrder < 1) {
    return undefined;
  }

  const rollingSummary: string | undefined = await readRollingSummary(paths, fileSystem);
  if (rollingSummary) {
    return rollingSummary;
  }

  return readPreviousDraftTail(paths, previousOrder, fileSystem);
}

async function readRollingSummary(
  paths: SceneContextWorkspacePaths,
  fileSystem: SceneContextWorkspaceFileSystem,
): Promise<string | undefined> {
  if (!paths.chapterSummaries) {
    return undefined;
  }

  try {
    const content: string = new TextDecoder().decode(
      await fileSystem.readFile(paths.chapterSummaries),
    );
    const fresh: string | undefined = dropStaleChapters(content.trim());
    return fresh === undefined ? undefined : boundSummary(fresh);
  } catch {
    return undefined;
  }
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

function joinSections(sections: readonly string[]): string {
  return sections.join('').trim();
}

function firstLines(section: string): string {
  const lines: string[] = section.split('\n');
  const heading: string = lines[0] ?? '';
  const summary: string = lines.slice(1).find((line) => line.trim().length > 0) ?? '';

  return `${heading}\n${summary.trim()}\n\n`;
}

async function readPreviousDraftTail(
  paths: SceneContextWorkspacePaths,
  previousOrder: number,
  fileSystem: SceneContextWorkspaceFileSystem,
): Promise<string | undefined> {
  try {
    const entries: WorkspaceDirectoryEntry[] = await fileSystem.readDirectory(paths.draftDirectory);
    const draftFiles: WorkspaceDirectoryEntry[] = entries.filter(
      ([name, entry]) => entry.type === 'file' && name.endsWith('.md'),
    );

    const previousFileName: WorkspaceDirectoryEntry | undefined = draftFiles.find(([name]) => {
      const match: RegExpExecArray | null = /^(\d+)-/.exec(name);
      return match && Number.parseInt(match[1] as string, 10) === previousOrder;
    });

    if (!previousFileName) {
      return undefined;
    }

    const uri: StoryUri = paths.joinPath(paths.draftDirectory, previousFileName[0]);
    const body: string = extractDraftBody(new TextDecoder().decode(await fileSystem.readFile(uri)));

    const lastCharacters: string = body.slice(-1000).trim();
    return lastCharacters.length > 0 ? lastCharacters : undefined;
  } catch {
    return undefined;
  }
}

export interface NarrativeContext {
  readonly bibleFacts: readonly BibleFact[];
  readonly prompt?: string;
  readonly characterKnowledge?: ReadonlyMap<string, readonly string[]>;
  readonly characterRelations?: ReadonlyMap<string, readonly string[]>;
}

export interface NarrativeContextOptions {
  readonly previousSceneOrder?: number;
  readonly focalFilter?: StoryStateFocalFilter;
}

export async function resolveSceneBibleFacts(
  paths: SceneContextWorkspacePaths,
  context: SceneContext,
  fileSystem: SceneContextWorkspaceFileSystem,
): Promise<readonly BibleFact[]> {
  const bible: StoryBible = await readSceneBible(paths, fileSystem);
  const storyTimeline: ReadonlyMap<number, number> | undefined = await readStoryTimeline(
    paths,
    fileSystem,
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

async function readStoryTimeline(
  paths: SceneContextWorkspacePaths,
  fileSystem: SceneContextWorkspaceFileSystem,
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
  let entries: [string, { type: 'file' | 'directory' }][];

  try {
    entries = await fileSystem.readDirectory(sceneDirectory);
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
          await fileSystem.readFile(paths.joinPath(sceneDirectory, fileName)),
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

export async function buildNarrativeContext(
  paths: SceneContextWorkspacePaths,
  context: SceneContext,
  fileSystem: SceneContextWorkspaceFileSystem,
  options?: NarrativeContextOptions,
): Promise<NarrativeContext> {
  const rawPreviousContext: string | undefined = await readPreviousSceneContext(
    paths,
    context.scene.order,
    fileSystem,
    options?.previousSceneOrder,
  );
  const previousContext: string | undefined =
    rawPreviousContext === undefined ? undefined : stripForeignScript(rawPreviousContext);
  const bibleFacts: readonly BibleFact[] = await resolveSceneBibleFacts(paths, context, fileSystem);
  const ledger: StoryState | undefined = await readSceneStoryLedger(
    paths,
    context.scene.order,
    fileSystem,
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

async function readSceneStoryLedger(
  paths: SceneContextWorkspacePaths,
  currentSceneOrder: number,
  fileSystem: SceneContextWorkspaceFileSystem,
): Promise<StoryState | undefined> {
  if (!paths.storyState || currentSceneOrder <= 1) {
    return undefined;
  }

  return await readStoryState(paths.storyState, fileSystem);
}

export function formatBibleFactLines(context: SceneContext, facts: readonly BibleFact[]): string[] {
  const names: ReadonlyMap<string, string> = sceneEntityNames(context);

  return facts.map((fact) => {
    const subject: string = names.get(`${fact.subject.kind}:${fact.subject.id}`) ?? fact.subject.id;

    return `${subject} — ${fact.key}: ${fact.value}${formatUnawareSuffix(context, fact)}`;
  });
}

function formatUnawareSuffix(context: SceneContext, fact: BibleFact): string {
  const knownBy: readonly string[] | undefined = revealKnownBy(fact);

  if (knownBy === undefined) {
    return '';
  }

  const unaware: string[] = context.characters
    .filter((character) => !knownBy.includes(character.id))
    .map((character) => character.name);

  return unaware.length === 0 ? '' : ` (아직 모름: ${unaware.join(', ')})`;
}

async function readSceneBible(
  paths: SceneContextWorkspacePaths,
  fileSystem: SceneContextWorkspaceFileSystem,
): Promise<StoryBible> {
  if (!paths.bibleCanon) {
    return createEmptyBible();
  }

  try {
    return await readBibleFile(paths.bibleCanon, fileSystem);
  } catch {
    return createEmptyBible();
  }
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

function sceneEntityNames(context: SceneContext): ReadonlyMap<string, string> {
  const names: Map<string, string> = new Map<string, string>();

  for (const character of context.characters) {
    names.set(`character:${character.id}`, character.name);
  }

  if (context.background) {
    names.set(`background:${context.background.id}`, context.background.name);
  }

  return names;
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

function isWorkingCardFileName(name: string): boolean {
  return name.endsWith('.card') && !isIgnoredSampleCardFileName(name);
}

async function listProjectCharacters(
  paths: SceneContextWorkspacePaths,
  fileSystem: SceneContextWorkspaceFileSystem,
): Promise<readonly CharacterCard[]> {
  try {
    const entries: WorkspaceDirectoryEntry[] = await fileSystem.readDirectory(
      paths.characterDirectory,
    );
    const cardFiles: WorkspaceDirectoryEntry[] = entries.filter(
      ([name, entry]) => entry.type === 'file' && isWorkingCardFileName(name),
    );

    const cards: (CharacterCard | undefined)[] = await Promise.all(
      cardFiles.map(async ([name]) => {
        const uri: StoryUri = paths.joinPath(paths.characterDirectory, name);
        try {
          const card: StoryboardCard = await readCardFile(uri, fileSystem);
          return card.type === 'character' ? card : undefined;
        } catch {
          return undefined;
        }
      }),
    );

    return cards.filter((card): card is CharacterCard => card !== undefined);
  } catch {
    return [];
  }
}

async function listProjectBackgrounds(
  paths: SceneContextWorkspacePaths,
  fileSystem: SceneContextWorkspaceFileSystem,
): Promise<readonly BackgroundCard[]> {
  try {
    const entries: WorkspaceDirectoryEntry[] = await fileSystem.readDirectory(
      paths.backgroundDirectory,
    );
    const cardFiles: WorkspaceDirectoryEntry[] = entries.filter(
      ([name, entry]) => entry.type === 'file' && isWorkingCardFileName(name),
    );

    const cards: (BackgroundCard | undefined)[] = await Promise.all(
      cardFiles.map(async ([name]) => {
        const uri: StoryUri = paths.joinPath(paths.backgroundDirectory, name);
        try {
          const card: StoryboardCard = await readCardFile(uri, fileSystem);
          return isBackgroundCard(card) ? card : undefined;
        } catch {
          return undefined;
        }
      }),
    );

    return cards.filter((card): card is BackgroundCard => card !== undefined);
  } catch {
    return [];
  }
}

function resolveSceneCharacters(
  scene: SceneFile,
  allCharacters: readonly CharacterCard[],
): readonly CharacterCard[] {
  if (scene.frontmatter.characters && scene.frontmatter.characters.length > 0) {
    const targetIds: Set<string> = new Set(scene.frontmatter.characters);
    return allCharacters.filter((char) => targetIds.has(char.id));
  }

  const detectableTokens: string[] = allCharacters.flatMap((char) => characterMatchTokens(char));
  const detectedTokens: Set<string> = new Set(detectCharactersInText(scene.body, detectableTokens));

  return allCharacters.filter((char) =>
    characterMatchTokens(char).some((token) => detectedTokens.has(token)),
  );
}

function resolveSceneBackground(
  scene: SceneFile,
  allBackgrounds: readonly BackgroundCard[],
): BackgroundCard | undefined {
  if (scene.frontmatter.location) {
    return allBackgrounds.find((bg) => bg.id === scene.frontmatter.location);
  }

  return detectSceneBackground(scene.body, allBackgrounds);
}

function detectSceneBackground(
  body: string,
  allBackgrounds: readonly BackgroundCard[],
): BackgroundCard | undefined {
  let best: { card: BackgroundCard; matchLength: number } | undefined;

  for (const background of allBackgrounds) {
    const tokens: string[] = [background.name, ...(background.aliases ?? [])];
    const matched: string[] = detectCharactersInText(body, tokens);
    if (matched.length === 0) {
      continue;
    }

    const matchLength: number = Math.max(...matched.map((token) => token.length));
    const isBetter: boolean =
      best === undefined ||
      matchLength > best.matchLength ||
      (matchLength === best.matchLength && background.id < best.card.id);

    if (isBetter) {
      best = { card: background, matchLength };
    }
  }

  return best?.card;
}
