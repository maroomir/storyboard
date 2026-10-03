import type { StoryUri } from './storyUri';
import {
  characterMatchTokens,
  isBackgroundCard,
  type BackgroundCard,
  type CharacterCard,
} from './card';
import { parseSceneFileName, type SceneFile } from './scene';
import { parseSceneCard } from './files/scene';
import { readCardFile } from './files/card';
import { readBibleFile } from './files/bible';
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
  type StoryStateFocalFilter,
} from './storyState';
import { stripForeignScript } from './foreignScript';

export interface SceneContextWorkspacePaths {
  readonly characterDirectory: StoryUri;
  // 서사 시간(§4.4)을 읽어 오는 곳. 없으면 씬 순번을 서사 시간으로 쓴다.
  readonly sceneDirectory?: StoryUri;
  readonly backgroundDirectory: StoryUri;
  readonly draftDirectory: StoryUri;
  readonly bibleCanon?: StoryUri;
  readonly chapterSummaries?: StoryUri;
  readonly storyState?: StoryUri;
  readonly joinPath: (base: StoryUri, ...pathSegments: string[]) => StoryUri;
}

export interface SceneContextWorkspaceFileSystem {
  readonly readFile: (uri: StoryUri) => PromiseLike<Uint8Array>;
  readonly writeFile: (uri: StoryUri, content: Uint8Array) => PromiseLike<void>;
  readonly readDirectory: (
    uri: StoryUri,
  ) => PromiseLike<[string, { type: 'file' | 'directory' }][]>;
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

  const characters = resolveSceneCharacters(scene, allCharacters);
  const background = resolveSceneBackground(scene, allBackgrounds);

  return {
    scene,
    characters,
    background,
  };
}

const summaryContextBudget = 8000;

// NOTE: previousSceneOrder는 같은 스레드의 직전 씬이다. 주지 않으면 종전대로 바로 앞 번호를 본다 —
// 스레드를 쓰지 않는 작품은 그 둘이 언제나 같다.
export async function readPreviousSceneContext(
  paths: SceneContextWorkspacePaths,
  currentSceneOrder: number,
  fileSystem: SceneContextWorkspaceFileSystem,
  previousSceneOrder?: number,
): Promise<string | undefined> {
  const previousOrder = previousSceneOrder ?? currentSceneOrder - 1;

  if (previousOrder < 1) {
    return undefined;
  }

  const rollingSummary = await readRollingSummary(paths, fileSystem);
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
    const content = new TextDecoder().decode(await fileSystem.readFile(paths.chapterSummaries));
    const fresh = dropStaleChapters(content.trim());
    return fresh === undefined ? undefined : boundSummary(fresh);
  } catch {
    return undefined;
  }
}

// A chapter marked stale was written from a draft that has since changed, so injecting it would
// carry the discarded version's events into the next scene. Dropping every chapter leaves only the
// file header, which is worth less than the previous draft's tail, so that falls back instead.
function dropStaleChapters(content: string): string | undefined {
  if (content.length === 0) {
    return undefined;
  }

  const [preamble, ...chapters] = content.split(/^(?=## )/m);
  const fresh = chapters.filter((chapter) => !isStaleChapterSection(chapter));

  if (chapters.length > 0 && fresh.length === 0) {
    return undefined;
  }

  return [preamble ?? '', ...fresh].join('').trim();
}

// Over budget, the oldest chapters are compressed to their first line rather than the whole file
// being cut from the front: a raw tail cut drops the opening chapters entirely, which is exactly
// where a long-range setup a later scene has to honour was established.
function boundSummary(content: string): string {
  const trimmed = content.trim();

  if (trimmed.length <= summaryContextBudget) {
    return trimmed;
  }

  const [preamble, ...chapters] = trimmed.split(/^(?=## )/m);
  const sections = [preamble ?? '', ...chapters];

  for (
    let index = 1;
    index < sections.length && joinSections(sections).length > summaryContextBudget;
    index += 1
  ) {
    sections[index] = firstLines(sections[index] ?? '');
  }

  const compressed = joinSections(sections);
  return compressed.length <= summaryContextBudget
    ? compressed
    : compressed.slice(-summaryContextBudget).trim();
}

function joinSections(sections: readonly string[]): string {
  return sections.join('').trim();
}

// The heading plus the first sentence-bearing line — enough to say which chapter it was and what
// happened, without the beat-by-beat detail a recent chapter still needs.
function firstLines(section: string): string {
  const lines = section.split('\n');
  const heading = lines[0] ?? '';
  const summary = lines.slice(1).find((line) => line.trim().length > 0) ?? '';

  return `${heading}\n${summary.trim()}\n\n`;
}

async function readPreviousDraftTail(
  paths: SceneContextWorkspacePaths,
  previousOrder: number,
  fileSystem: SceneContextWorkspaceFileSystem,
): Promise<string | undefined> {
  try {
    const entries = await fileSystem.readDirectory(paths.draftDirectory);
    const draftFiles = entries.filter(
      ([name, entry]) => entry.type === 'file' && name.endsWith('.md'),
    );

    const previousFileName = draftFiles.find(([name]) => {
      const match = /^(\d+)-/.exec(name);
      return match && Number.parseInt(match[1] as string, 10) === previousOrder;
    });

    if (!previousFileName) {
      return undefined;
    }

    const uri = paths.joinPath(paths.draftDirectory, previousFileName[0]);
    const content = new TextDecoder().decode(await fileSystem.readFile(uri));

    const lastCharacters = content.slice(-1000).trim();
    return lastCharacters.length > 0 ? lastCharacters : undefined;
  } catch {
    return undefined;
  }
}

export interface NarrativeContext {
  readonly bibleFacts: readonly BibleFact[];
  readonly prompt?: string;
}

export interface NarrativeContextOptions {
  // 같은 스레드의 직전 씬 번호. 생략하면 바로 앞 번호를 본다.
  readonly previousSceneOrder?: number;
  // 목격 범위 서술자의 초점 인물. 주면 그 인물이 목격하지 않은 이야기 상태 항목을 빼고 준다.
  readonly focalFilter?: StoryStateFocalFilter;
}

// NOTE: 씬 입력 해시(computeSceneInputHash)에도 이 사실 목록이 들어간다. 원장 감사가 지난 씬의
// 해시를 다시 계산할 때 초안 꼬리나 원장까지 읽을 필요가 없도록 사실 해석만 따로 뽑아 둔다.
export async function resolveSceneBibleFacts(
  paths: SceneContextWorkspacePaths,
  context: SceneContext,
  fileSystem: SceneContextWorkspaceFileSystem,
): Promise<readonly BibleFact[]> {
  const bible = await readSceneBible(paths, fileSystem);
  const storyTimeline = await readStoryTimeline(paths, fileSystem, bible);

  return selectInjectedFacts(bible, sceneSubjects(context), context.scene.body, context.scene.order, {
    ...(storyTimeline === undefined ? {} : { storyTimeline }),
  });
}

// 유효 구간을 쓰는 사실이 하나도 없으면 서사 시간을 볼 일도 없다. 씬을 전부 읽는 비용을 그때만
// 치르게 해, 시간축을 쓰지 않는 워크스페이스는 종전과 같은 읽기 수로 남는다.
async function readStoryTimeline(
  paths: SceneContextWorkspacePaths,
  fileSystem: SceneContextWorkspaceFileSystem,
  bible: StoryBible,
): Promise<ReadonlyMap<number, number> | undefined> {
  const usesRanges = bible.facts.some(
    (fact) => fact.validFrom !== undefined || fact.validUntil !== undefined,
  );

  if (!usesRanges || !paths.sceneDirectory) {
    return undefined;
  }

  const sceneDirectory = paths.sceneDirectory;
  const timeline = new Map<number, number>();
  let entries: [string, { type: 'file' | 'directory' }][];

  try {
    entries = await fileSystem.readDirectory(sceneDirectory);
  } catch {
    return undefined;
  }

  await Promise.all(
    entries.map(async ([fileName, entry]) => {
      const parts = entry.type === 'file' ? parseSceneFileName(fileName) : undefined;

      if (parts === undefined) {
        return;
      }

      try {
        const raw = new TextDecoder().decode(
          await fileSystem.readFile(paths.joinPath(sceneDirectory, fileName)),
        );
        const storyTime = parseSceneCard(raw).storyTime;

        if (storyTime !== undefined) {
          timeline.set(parts.order, storyTime);
        }
      } catch {
        // 읽히지 않는 씬은 시간을 선언하지 않은 것과 같다. 순번을 그대로 쓴다.
      }
    }),
  );

  return timeline.size > 0 ? timeline : undefined;
}

// NOTE: Replaces the raw previous-draft tail as the pipeline's previousContext, prepending
// canon bible facts for the scene's entities so long-range setting stays consistent.
export async function buildNarrativeContext(
  paths: SceneContextWorkspacePaths,
  context: SceneContext,
  fileSystem: SceneContextWorkspaceFileSystem,
  options?: NarrativeContextOptions,
): Promise<NarrativeContext> {
  const rawPreviousContext = await readPreviousSceneContext(
    paths,
    context.scene.order,
    fileSystem,
    options?.previousSceneOrder,
  );
  const previousContext =
    rawPreviousContext === undefined ? undefined : stripForeignScript(rawPreviousContext);
  const bibleFacts = await resolveSceneBibleFacts(paths, context, fileSystem);
  const storyState = await readSceneStoryState(
    paths,
    context.scene.order,
    fileSystem,
    context.scene.body,
    options?.focalFilter,
  );
  const prompt = composeNarrativePrompt(
    formatBibleFactLines(context, bibleFacts),
    storyState,
    previousContext,
  );

  return { bibleFacts, prompt };
}

// NOTE: 원장은 직전 씬까지의 상태다. 씬을 다시 생성할 때 자기 자신이 남긴 상태를 되먹지 않도록
// 현재 씬보다 앞선 분량만 주입한다.
async function readSceneStoryState(
  paths: SceneContextWorkspacePaths,
  currentSceneOrder: number,
  fileSystem: SceneContextWorkspaceFileSystem,
  sceneText: string,
  focalFilter: StoryStateFocalFilter | undefined,
): Promise<string | undefined> {
  if (!paths.storyState || currentSceneOrder <= 1) {
    return undefined;
  }

  const state = await readStoryState(paths.storyState, fileSystem);
  return formatStoryStateForPrompt(state, currentSceneOrder, sceneText, focalFilter);
}

export function formatBibleFactLines(context: SceneContext, facts: readonly BibleFact[]): string[] {
  const names = sceneEntityNames(context);

  return facts.map((fact) => {
    const subject = names.get(`${fact.subject.kind}:${fact.subject.id}`) ?? fact.subject.id;

    return `${subject} — ${fact.key}: ${fact.value}${formatUnawareSuffix(context, fact)}`;
  });
}

// 독자에게 공개된 사실이라고 등장 인물이 다 아는 것은 아니다. knownBy가 적힌 사실은 아직 모르는
// 인물을 이름으로 적어, 서술자는 알고 그 인물은 모르는 장면을 쓸 수 있게 한다.
function formatUnawareSuffix(context: SceneContext, fact: BibleFact): string {
  const knownBy = revealKnownBy(fact);

  if (knownBy === undefined) {
    return '';
  }

  const unaware = context.characters
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
  const names = new Map<string, string>();

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

  const trimmedPrevious = previousContext?.trim();
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
    const entries = await fileSystem.readDirectory(paths.characterDirectory);
    const cardFiles = entries.filter(
      ([name, entry]) => entry.type === 'file' && isWorkingCardFileName(name),
    );

    const cards = await Promise.all(
      cardFiles.map(async ([name]) => {
        const uri = paths.joinPath(paths.characterDirectory, name);
        try {
          const card = await readCardFile(uri, fileSystem);
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
    const entries = await fileSystem.readDirectory(paths.backgroundDirectory);
    const cardFiles = entries.filter(
      ([name, entry]) => entry.type === 'file' && isWorkingCardFileName(name),
    );

    const cards = await Promise.all(
      cardFiles.map(async ([name]) => {
        const uri = paths.joinPath(paths.backgroundDirectory, name);
        try {
          const card = await readCardFile(uri, fileSystem);
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
    const targetIds = new Set(scene.frontmatter.characters);
    return allCharacters.filter((char) => targetIds.has(char.id));
  }

  const detectableTokens = allCharacters.flatMap((char) => characterMatchTokens(char));
  const detectedTokens = new Set(detectCharactersInText(scene.body, detectableTokens));

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
    const tokens = [background.name, ...(background.aliases ?? [])];
    const matched = detectCharactersInText(body, tokens);
    if (matched.length === 0) {
      continue;
    }

    const matchLength = Math.max(...matched.map((token) => token.length));
    const isBetter =
      best === undefined ||
      matchLength > best.matchLength ||
      (matchLength === best.matchLength && background.id < best.card.id);

    if (isBetter) {
      best = { card: background, matchLength };
    }
  }

  return best?.card;
}
