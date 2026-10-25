import { z } from 'zod';

export const sceneFileNamePattern: RegExp = /^(\d+)-([a-z0-9][a-z0-9-]*)\.card$/;
export const sceneStemPattern: RegExp = /^(\d+)-([a-z0-9][a-z0-9-]*)$/;
export const sceneSummaryFileNamePattern: RegExp = /^(\d+)-([a-z0-9][a-z0-9-]*)\.summary\.md$/;

export type SceneGroundingFieldKey = 'incident' | 'place' | 'relation' | 'time';

export const sceneGroundingFieldKeys: readonly [SceneGroundingFieldKey, ...SceneGroundingFieldKey[]] = ['incident', 'place', 'relation', 'time'];

export interface SceneGrounding {
  incident?: string;
  place?: string;
  relation?: string;
  time?: string;
}

export const sceneGroundingSchema: z.ZodType<SceneGrounding> = z.object({
  incident: z.string().trim().min(1).optional(),
  place: z.string().trim().min(1).optional(),
  relation: z.string().trim().min(1).optional(),
  time: z.string().trim().min(1).optional(),
});

export const sceneGroundingFieldLabels: Readonly<Record<SceneGroundingFieldKey, string>> = {
  incident: '사건',
  place: '장소',
  relation: '관계',
  time: '시점',
};

export interface SceneBeatDetail {
  text: string;
  cast?: string[];
  place?: string;
  time?: string;
  break?: boolean;
}

export const sceneBeatDetailSchema: z.ZodType<SceneBeatDetail> = z.object({
  text: z.string().trim().min(1),
  cast: z.array(z.string().trim().min(1)).optional(),
  place: z.string().trim().min(1).optional(),
  time: z.string().trim().min(1).optional(),
  break: z.boolean().optional(),
});

export type SceneBeat = string | SceneBeatDetail;

export const sceneBeatSchema: z.ZodType<SceneBeat> = z.union([z.string().trim().min(1), sceneBeatDetailSchema]);

export function sceneBeatText(beat: SceneBeat): string {
  return typeof beat === 'string' ? beat : beat.text;
}

export function sceneBeatTexts(beats: readonly SceneBeat[] | undefined): string[] {
  return (beats ?? []).map(sceneBeatText);
}

export interface UnknownBeatCast {
  readonly beat: number;
  readonly ref: string;
}

export function findUnknownBeatCast(
  beats: readonly SceneBeat[] | undefined,
  characters: readonly {
    readonly id: string;
    readonly name: string;
    readonly aliases?: readonly string[];
  }[],
): UnknownBeatCast[] {
  const known: Set<string> = new Set(
    characters.flatMap((character) => [character.id, character.name, ...(character.aliases ?? [])]),
  );

  return (beats ?? []).flatMap((beat, index) =>
    typeof beat === 'string'
      ? []
      : (beat.cast ?? []).filter((ref) => !known.has(ref)).map((ref) => ({ beat: index + 1, ref })),
  );
}

export const sceneBeatCoordinateLabels: Readonly<Record<'cast' | 'place' | 'time', string>> = {
  cast: '출연',
  place: '장소',
  time: '시각',
};

export function formatSceneBeatCoordinates(
  beat: SceneBeat,
  castName: (ref: string) => string = (ref) => ref,
): string | undefined {
  if (typeof beat === 'string') {
    return undefined;
  }

  const coordinates: string[] = [
    beat.cast && beat.cast.length > 0
      ? `${sceneBeatCoordinateLabels.cast}: ${beat.cast.map(castName).join(', ')}`
      : undefined,
    beat.place ? `${sceneBeatCoordinateLabels.place}: ${beat.place}` : undefined,
    beat.time ? `${sceneBeatCoordinateLabels.time}: ${beat.time}` : undefined,
  ].filter((part): part is string => part !== undefined);

  return coordinates.length > 0 ? coordinates.join(' / ') : undefined;
}

export function renderSceneBeat(
  beat: SceneBeat,
  castName: (ref: string) => string = (ref) => ref,
): string {
  const coordinates: string | undefined = formatSceneBeatCoordinates(beat, castName);

  return coordinates === undefined ? sceneBeatText(beat) : `${sceneBeatText(beat)}\n(${coordinates})`;
}

export interface SceneFrontmatter {
  title?: string;
  characters?: string[];
  location?: string;
  mood?: string;
  relationStage?: string;
  povCharacter?: string;
  narrator?: string;
  thread?: string;
  targetWordCount?: number;
  storyTime?: number;
  grounding?: SceneGrounding;
  [key: string]: unknown;
}

export const sceneFrontmatterSchema: z.ZodType<SceneFrontmatter> = z
  .object({
    title: z.string().trim().min(1).optional(),
    characters: z.array(z.string().trim().min(1)).optional(),
    location: z.string().trim().min(1).optional(),
    mood: z.string().trim().min(1).optional(),
    relationStage: z.string().trim().min(1).optional(),
    povCharacter: z.string().trim().min(1).optional(),
    narrator: z.string().trim().min(1).optional(),
    thread: z.string().trim().min(1).optional(),
    targetWordCount: z.number().int().positive().optional(),
    storyTime: z.number().int().optional(),
    grounding: sceneGroundingSchema.optional(),
  })
  .passthrough();

export interface SceneCard {
  type: 'scene';
  id: string;
  title?: string;
  characters?: string[];
  location?: string;
  mood?: string;
  relationStage?: string;
  povCharacter?: string;
  narrator?: string;
  thread?: string;
  targetWordCount?: number;
  storyTime?: number;
  grounding?: SceneGrounding;
  purpose?: string;
  conflict?: string;
  twist?: string;
  emotionalShift?: string;
  endState?: string;
  foreshadowing?: string[];
  neededCanon?: string[];
  summary?: string;
  beats?: SceneBeat[];
}

export const sceneCardSchema: z.ZodType<SceneCard> = z.object({
  type: z.literal('scene'),
  id: z.string().regex(sceneStemPattern, {
    message: "Scene card id는 'NN-slug' 형식이어야 합니다.",
  }),
  title: z.string().trim().min(1).optional(),
  characters: z.array(z.string().trim().min(1)).optional(),
  location: z.string().trim().min(1).optional(),
  mood: z.string().trim().min(1).optional(),
  relationStage: z.string().trim().min(1).optional(),
  povCharacter: z.string().trim().min(1).optional(),
  narrator: z.string().trim().min(1).optional(),
  thread: z.string().trim().min(1).optional(),
  targetWordCount: z.number().int().positive().optional(),
  storyTime: z.number().int().optional(),
  grounding: sceneGroundingSchema.optional(),
  purpose: z.string().trim().min(1).optional(),
  conflict: z.string().trim().min(1).optional(),
  twist: z.string().trim().min(1).optional(),
  emotionalShift: z.string().trim().min(1).optional(),
  endState: z.string().trim().min(1).optional(),
  foreshadowing: z.array(z.string().trim().min(1)).optional(),
  neededCanon: z.array(z.string().trim().min(1)).optional(),
  summary: z.string().optional(),
  beats: z.array(sceneBeatSchema).optional(),
});

export interface SceneFileNameParts {
  readonly stem: string;
  readonly order: number;
  readonly orderText: string;
  readonly slug: string;
}

export interface SceneFile {
  readonly stem: string;
  readonly order: number;
  readonly orderText: string;
  readonly slug: string;
  readonly card: SceneCard;
  readonly frontmatter: SceneFrontmatter;
  readonly body: string;
  readonly summaryText?: string;
}

export function sceneSummaryFileName(stem: string): string {
  return `${stem}.summary.md`;
}

export function sceneSummaryReference(summary: string | undefined): string | undefined {
  const trimmed: string | undefined = summary?.trim();
  return trimmed !== undefined && sceneSummaryFileNamePattern.test(trimmed) ? trimmed : undefined;
}

export function isSceneSummaryReference(summary: string | undefined): boolean {
  return sceneSummaryReference(summary) !== undefined;
}

export function isInlineSceneSummary(summary: string | undefined): boolean {
  return summary !== undefined && summary.trim().length > 0 && !isSceneSummaryReference(summary);
}

export interface SceneSummaryExtraction {
  readonly card: SceneCard;
  readonly summaryFileName: string;
  readonly summaryText: string;
}

export function extractInlineSceneSummary(card: SceneCard): SceneSummaryExtraction | undefined {
  if (card.summary === undefined || !isInlineSceneSummary(card.summary)) {
    return undefined;
  }

  const summaryFileName: string = sceneSummaryFileName(card.id);

  return {
    card: { ...card, summary: summaryFileName },
    summaryFileName,
    summaryText: `${card.summary.trim()}\n`,
  };
}

export function toSceneFrontmatter(card: SceneCard): SceneFrontmatter {
  return {
    ...(card.title === undefined ? {} : { title: card.title }),
    ...(card.characters === undefined ? {} : { characters: card.characters }),
    ...(card.location === undefined ? {} : { location: card.location }),
    ...(card.mood === undefined ? {} : { mood: card.mood }),
    ...(card.relationStage === undefined ? {} : { relationStage: card.relationStage }),
    ...(card.povCharacter === undefined ? {} : { povCharacter: card.povCharacter }),
    ...(card.narrator === undefined ? {} : { narrator: card.narrator }),
    ...(card.thread === undefined ? {} : { thread: card.thread }),
    ...(card.targetWordCount === undefined ? {} : { targetWordCount: card.targetWordCount }),
    ...(card.storyTime === undefined ? {} : { storyTime: card.storyTime }),
    ...(card.grounding === undefined ? {} : { grounding: card.grounding }),
  };
}

export type SceneSeedSection =
  | 'purpose'
  | 'conflict'
  | 'twist'
  | 'emotionalShift'
  | 'endState'
  | 'foreshadowing'
  | 'neededCanon'
  | 'targetWordCount';

export const sceneSeedSectionLabels: Readonly<Record<SceneSeedSection, string>> = {
  purpose: '목적',
  conflict: '갈등',
  twist: '반전',
  emotionalShift: '감정 변화',
  endState: '이 장면의 종료 지점',
  foreshadowing: '회수할 복선',
  neededCanon: '필요 설정',
  targetWordCount: '목표 분량',
};

export const sceneSummaryLabel: string = '창작자 요약';

export function renderSceneCardBody(
  card: SceneCard,
  summaryText?: string,
  castName?: (ref: string) => string,
): string {
  const blocks: string[] = [];

  if (card.purpose !== undefined) {
    blocks.push(`[${sceneSeedSectionLabels.purpose}]\n${card.purpose}`);
  }
  if (card.conflict !== undefined) {
    blocks.push(`[${sceneSeedSectionLabels.conflict}]\n${card.conflict}`);
  }
  if (card.twist !== undefined) {
    blocks.push(
      `[${sceneSeedSectionLabels.twist}]\n${card.twist}\n이 반전은 독자가 이상을 분명히 알아볼 수 있게 써라. 평소에는 어땠는지를 먼저 보이고 무엇이 달라졌는지 대비하라. 특정 인물만 알아채는 반전이면, 그 자리의 다른 사람들은 알아채지 못한다는 것까지 함께 보여라.`,
    );
  }
  if (card.emotionalShift !== undefined) {
    blocks.push(`[${sceneSeedSectionLabels.emotionalShift}]\n${card.emotionalShift}`);
  }
  if (card.endState !== undefined) {
    blocks.push(
      `[${sceneSeedSectionLabels.endState}]\n${card.endState}\n이 지점에서 장면을 끝내고, 그 뒤의 사건은 다음 장면의 몫이므로 쓰지 마라.`,
    );
  }
  if (card.foreshadowing !== undefined && card.foreshadowing.length > 0) {
    blocks.push(
      `[${sceneSeedSectionLabels.foreshadowing}]\n${card.foreshadowing.map((item) => `- ${item}`).join('\n')}`,
    );
  }
  if (card.neededCanon !== undefined && card.neededCanon.length > 0) {
    blocks.push(
      `[${sceneSeedSectionLabels.neededCanon}]\n${card.neededCanon.map((item) => `- ${item}`).join('\n')}`,
    );
  }
  if (card.targetWordCount !== undefined) {
    blocks.push(
      `[${sceneSeedSectionLabels.targetWordCount}]\n약 ${card.targetWordCount.toLocaleString('en-US')}자`,
    );
  }

  const beats: SceneBeat[] = card.beats ?? [];
  const summary: string | undefined = summaryText?.trim();
  const hasSummary: boolean = summary !== undefined && summary.length > 0;
  if (beats.length > 0) {
    if (hasSummary && summary !== undefined) {
      blocks.push(`[${sceneSummaryLabel}]\n${summary.replace(/\n\s*\n+/g, '\n')}`);
    }
    blocks.push(beats.map((beat) => renderSceneBeat(beat, castName)).join('\n\n'));
  } else if (hasSummary && summary !== undefined) {
    blocks.push(summary);
  }

  return blocks.length > 0 ? `${blocks.join('\n\n')}\n` : '';
}

export function extractSceneNarrativeSource(body: string): string {
  return splitSceneNarrativeSource(body).narrative;
}

export interface SceneNarrativeParts {
  readonly narrative: string;
  readonly design: string;
}

export function splitSceneNarrativeSource(body: string): SceneNarrativeParts {
  const blocks: string[] = body
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
  const narrative: string[] = blocks.filter((block) => !block.startsWith('['));

  if (narrative.length === 0) {
    return { narrative: body.trim(), design: '' };
  }

  return {
    narrative: narrative.join('\n\n'),
    design: blocks.filter((block) => block.startsWith('[')).join('\n\n'),
  };
}

export function parseSceneFileName(fileName: string): SceneFileNameParts | undefined {
  const match: RegExpExecArray | null = sceneFileNamePattern.exec(fileName);

  if (!match) {
    return undefined;
  }

  const orderText: string | undefined = match[1];
  const slug: string | undefined = match[2];

  if (!orderText || !slug) {
    return undefined;
  }

  return {
    stem: `${orderText}-${slug}`,
    order: Number.parseInt(orderText, 10),
    orderText,
    slug,
  };
}

export function parseSceneStem(stem: string): SceneFileNameParts | undefined {
  const match: RegExpExecArray | null = sceneStemPattern.exec(stem);

  if (!match) {
    return undefined;
  }

  const orderText: string | undefined = match[1];
  const slug: string | undefined = match[2];

  if (!orderText || !slug) {
    return undefined;
  }

  return {
    stem,
    order: Number.parseInt(orderText, 10),
    orderText,
    slug,
  };
}

export function resolveSceneOrder(ref: string | number): number | undefined {
  if (typeof ref === 'number') {
    return Number.isInteger(ref) && ref > 0 ? ref : undefined;
  }

  const trimmed: string = ref.trim();

  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }

  return parseSceneStem(trimmed)?.order;
}
