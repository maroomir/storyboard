import { z } from 'zod';

export const sceneFileNamePattern = /^(\d+)-([a-z0-9][a-z0-9-]*)\.card$/;
export const legacySceneFileNamePattern = /^(\d+)-([a-z0-9][a-z0-9-]*)\.txt$/;
export const sceneStemPattern = /^(\d+)-([a-z0-9][a-z0-9-]*)$/;
// 창작자가 쓴 사건 산문은 카드 옆 `<stem>.summary.md`에 두고, 카드의 summary 에는 그 파일명만 적는다.
export const sceneSummaryFileNamePattern = /^(\d+)-([a-z0-9][a-z0-9-]*)\.summary\.md$/;

// 씬을 구체적인 사건으로 못박는 4개 사실. 가사·분위기 스케치처럼 추상적인 씬이 은유만으로
// 생성되는 것을 막는다.
export const sceneGroundingFieldKeys = ['incident', 'place', 'relation', 'time'] as const;

export type SceneGroundingFieldKey = (typeof sceneGroundingFieldKeys)[number];

export const sceneGroundingSchema = z.object({
  incident: z.string().trim().min(1).optional(),
  place: z.string().trim().min(1).optional(),
  relation: z.string().trim().min(1).optional(),
  time: z.string().trim().min(1).optional(),
});

export type SceneGrounding = z.infer<typeof sceneGroundingSchema>;

export const sceneGroundingFieldLabels: Readonly<Record<SceneGroundingFieldKey, string>> = {
  incident: '사건',
  place: '장소',
  relation: '관계',
  time: '시점',
};

export const sceneFrontmatterSchema = z
  .object({
    title: z.string().trim().min(1).optional(),
    characters: z.array(z.string().trim().min(1)).optional(),
    location: z.string().trim().min(1).optional(),
    mood: z.string().trim().min(1).optional(),
    relationStage: z.string().trim().min(1).optional(),
    povCharacter: z.string().trim().min(1).optional(),
    targetWordCount: z.number().int().positive().optional(),
    grounding: sceneGroundingSchema.optional(),
  })
  .passthrough();

export const sceneCardSchema = z.object({
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
  targetWordCount: z.number().int().positive().optional(),
  grounding: sceneGroundingSchema.optional(),
  purpose: z.string().trim().min(1).optional(),
  conflict: z.string().trim().min(1).optional(),
  twist: z.string().trim().min(1).optional(),
  emotionalShift: z.string().trim().min(1).optional(),
  endState: z.string().trim().min(1).optional(),
  foreshadowing: z.array(z.string().trim().min(1)).optional(),
  neededCanon: z.array(z.string().trim().min(1)).optional(),
  summary: z.string().optional(),
  beats: z.array(z.string().trim().min(1)).optional(),
});

export type SceneCard = z.infer<typeof sceneCardSchema>;

export interface SceneFileNameParts {
  readonly stem: string;
  readonly order: number;
  readonly orderText: string;
  readonly slug: string;
}

export type SceneFrontmatter = z.infer<typeof sceneFrontmatterSchema>;

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
  const trimmed = summary?.trim();
  return trimmed !== undefined && sceneSummaryFileNamePattern.test(trimmed) ? trimmed : undefined;
}

export function isSceneSummaryReference(summary: string | undefined): boolean {
  return sceneSummaryReference(summary) !== undefined;
}

// 파일로 옮기지 않은 인라인 산문. doctor 가 세고 `scene migrate` 가 파일로 뽑는다.
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

  const summaryFileName = sceneSummaryFileName(card.id);

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
    ...(card.targetWordCount === undefined ? {} : { targetWordCount: card.targetWordCount }),
    ...(card.grounding === undefined ? {} : { grounding: card.grounding }),
  };
}

export const sceneSeedSectionLabels = {
  purpose: '목적',
  conflict: '갈등',
  twist: '반전',
  emotionalShift: '감정 변화',
  endState: '이 장면의 종료 지점',
  foreshadowing: '회수할 복선',
  neededCanon: '필요 설정',
  targetWordCount: '목표 분량',
} as const;

// NOTE: 프롬프트는 씬 의도를 하나의 텍스트로 받는다. 구조 필드를 기존 씬 시드와 같은
// `[라벨]` 블록으로 렌더링해 프롬프트 계약을 바꾸지 않는다. 사건 재료는 라벨 없는 블록으로 놓이며
// beats 가 있으면 그것이 summary 산문을 대신한다(beats 는 summary 안에서 펼친 것이라 중복이다).
export function renderSceneCardBody(card: SceneCard, summaryText?: string): string {
  const blocks: string[] = [];

  if (card.purpose !== undefined) {
    blocks.push(`[${sceneSeedSectionLabels.purpose}]\n${card.purpose}`);
  }
  if (card.conflict !== undefined) {
    blocks.push(`[${sceneSeedSectionLabels.conflict}]\n${card.conflict}`);
  }
  if (card.twist !== undefined) {
    // NOTE: 반전을 사건으로만 적어 두면 평범한 반응과 구별되지 않아 독자가 이상을 알아채지 못한다.
    // 무엇이 평소와 다른지 대비로 보이고, 알아채는 사람이 정해져 있으면 그 유일성까지 쓰게 한다.
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

  const beats = card.beats ?? [];
  const summary = summaryText?.trim();
  if (beats.length > 0) {
    blocks.push(beats.join('\n\n'));
  } else if (summary !== undefined && summary.length > 0) {
    blocks.push(summary);
  }

  return blocks.length > 0 ? `${blocks.join('\n\n')}\n` : '';
}

// NOTE: 상황 추출은 '일어난 일'만 받아야 한다. 씬 본문에는 요약 앞에 [갈등]·[반전]·[종료 지점]
// 같은 작법 블록이 놓이는데, 추출기가 이것들을 사건으로 읽으면 같은 등장이 두 번 뽑히거나
// (「발키리가 시비를 건다」가 [갈등]과 요약에서 각각) 금지문이 소재로 둔갑한다(「브로크와의 대면은
// 다음 장면에」→ 대장간 도착을 씀). 그래서 사건 목록만 따로 떼어 넘긴다.
export function extractSceneNarrativeSource(body: string): string {
  const blocks = body
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
  const narrative = blocks.filter((block) => !block.startsWith('['));

  return narrative.length > 0 ? narrative.join('\n\n') : body.trim();
}

// NOTE: 0.8 이전 `scene seeds`는 summary에 안내 문구 한 줄을 넣었다. summary가 비어 있지 않으면
// extractSceneNarrativeSource가 그것만을 서사 재료로 삼으므로, 남아 있으면 초안이 안내 문구로 쓰인다.
const legacySeedPlaceholderSuffix =
  '자동 생성된 씬 시드입니다. 초안 생성 전에 자유롭게 수정하세요.';

export function isLegacySeedPlaceholderSummary(summary: string | undefined): boolean {
  return summary !== undefined && summary.trim().endsWith(legacySeedPlaceholderSuffix);
}

// 저자가 안내 문구를 지우지 않고 그 위에 요약을 써 둔 카드도 있으므로 마지막 줄만 걷어 낸다.
export function stripLegacySeedPlaceholder(summary: string): string | undefined {
  const lines = summary.trimEnd().split('\n');
  lines.pop();
  const authored = lines.join('\n').trim();

  return authored.length > 0 ? authored : undefined;
}

export function parseSceneFileName(fileName: string): SceneFileNameParts | undefined {
  const match = sceneFileNamePattern.exec(fileName);

  if (!match) {
    return undefined;
  }

  const orderText = match[1];
  const slug = match[2];

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
  const match = sceneStemPattern.exec(stem);

  if (!match) {
    return undefined;
  }

  const orderText = match[1];
  const slug = match[2];

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

// NOTE: File-agnostic timeline coordinate for canon-fact validity ranges. Accepts a bare
// order, a numeric string, or an `NN-slug` scene stem; returns undefined for anything else.
export function resolveSceneOrder(ref: string | number): number | undefined {
  if (typeof ref === 'number') {
    return Number.isInteger(ref) && ref > 0 ? ref : undefined;
  }

  const trimmed = ref.trim();

  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }

  return parseSceneStem(trimmed)?.order;
}
