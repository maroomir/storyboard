import { z } from 'zod';

export const sceneFileNamePattern = /^(\d+)-([a-z0-9][a-z0-9-]*)\.card$/;
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
    narrator: z.string().trim().min(1).optional(),
    thread: z.string().trim().min(1).optional(),
    targetWordCount: z.number().int().positive().optional(),
    // 서사 시간 축. 없으면 씬 순서를 쓴다. 회상·액자처럼 서술 순서와 사건 순서가 어긋나는 씬에만
    // 적으면 되고, 캐넌의 validFrom/validUntil은 이 축으로 비교한다.
    storyTime: z.number().int().optional(),
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
  // 이 씬의 서술자 카드 id와 연속성 줄기. 생략하면 장 → 프로젝트 기본으로 내려간다.
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

// 파일로 옮기지 않은 인라인 산문.
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
    ...(card.narrator === undefined ? {} : { narrator: card.narrator }),
    ...(card.thread === undefined ? {} : { thread: card.thread }),
    ...(card.targetWordCount === undefined ? {} : { targetWordCount: card.targetWordCount }),
    ...(card.storyTime === undefined ? {} : { storyTime: card.storyTime }),
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

export const sceneSummaryLabel = '창작자 요약';

// NOTE: 프롬프트는 씬 의도를 하나의 텍스트로 받는다. 구조 필드를 기존 씬 시드와 같은
// `[라벨]` 블록으로 렌더링해 프롬프트 계약을 바꾸지 않는다. 사건 재료는 라벨 없는 블록으로 놓이며
// beats 가 있으면 그것이 사건 재료다. 그때 summary 는 비트에 없는 질감(말버릇·분위기·작가 메모)을
// 담으므로 버리지 않고 설계 블록으로 함께 넘긴다 — 한 블록으로 묶어야 사건 재료로 읽히지 않는다.
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
  const hasSummary = summary !== undefined && summary.length > 0;
  if (beats.length > 0) {
    if (hasSummary) {
      blocks.push(`[${sceneSummaryLabel}]\n${summary.replace(/\n\s*\n+/g, '\n')}`);
    }
    blocks.push(beats.join('\n\n'));
  } else if (hasSummary) {
    blocks.push(summary);
  }

  return blocks.length > 0 ? `${blocks.join('\n\n')}\n` : '';
}

// NOTE: 상황 추출은 '일어난 일'만 받아야 한다. 씬 본문에는 요약 앞에 [갈등]·[반전]·[종료 지점]
// 같은 작법 블록이 놓이는데, 추출기가 이것들을 사건으로 읽으면 같은 등장이 두 번 뽑히거나
// (「발키리가 시비를 건다」가 [갈등]과 요약에서 각각) 금지문이 소재로 둔갑한다(「브로크와의 대면은
// 다음 장면에」→ 대장간 도착을 씀). 그래서 사건 목록만 따로 떼어 넘긴다.
export function extractSceneNarrativeSource(body: string): string {
  return splitSceneNarrativeSource(body).narrative;
}

export interface SceneNarrativeParts {
  // 사건 재료. 뼈대가 «무엇이 일어나는가»로 삼는 것.
  readonly narrative: string;
  // 목적·갈등·반전 같은 설계 블록. 사건 재료와 섞으면 카드 메타가 산문으로 새므로 따로 넘긴다.
  // 사건 재료가 따로 없어 본문 전체가 재료가 된 경우에는 비어 있다 — 이미 그 안에 들어 있다.
  readonly design: string;
}

// NOTE: 비트나 요약이 있으면 설계 블록이 통째로 버려져 뼈대가 목적·갈등·반전을 모르는 채 쓰였다.
// 실측(sonnet, 목표 3,000자·1구간)에서 뼈대가 1,801자 → 743자로 줄어 초안이 그만큼 짧아졌다.
// 재료와 설계를 나눠 둘 다 넘기되, 섞지는 않는다.
export function splitSceneNarrativeSource(body: string): SceneNarrativeParts {
  const blocks = body
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter((block) => block.length > 0);
  const narrative = blocks.filter((block) => !block.startsWith('['));

  if (narrative.length === 0) {
    return { narrative: body.trim(), design: '' };
  }

  return {
    narrative: narrative.join('\n\n'),
    design: blocks.filter((block) => block.startsWith('[')).join('\n\n'),
  };
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
