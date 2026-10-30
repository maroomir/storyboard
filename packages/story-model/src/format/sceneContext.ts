import type { StoryUri } from '#model/format/storyUri';
import { characterMatchTokens, type BackgroundCard, type CharacterCard } from '#model/format/card';
import type { SceneFile } from '#model/format/scene';
import { revealKnownBy, type BibleFact } from '#model/format/bible';
import { detectCharactersInText } from '#model/format/characterDetector';
import type { StoryStateFocalFilter } from '#model/format/storyState';

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

export interface SceneContext {
  readonly scene: SceneFile;
  readonly characters: readonly CharacterCard[];
  readonly background?: BackgroundCard;
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

export function resolveSceneCharacters(
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

export function resolveSceneBackground(
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
