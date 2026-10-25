import { providerCatalog } from './providerCatalog';

export type {
  AiProviderId,
  ModelPricePerMillion,
  ProviderCatalogEntry,
  ProviderModelEntry,
  ProviderModelOption,
  ProviderModelOptions,
  ProviderTransport,
} from './providerCatalog';
export {
  acceptsTemperature,
  aiProviderIds,
  connectionCheckFailedMessage,
  generationFailedMessage,
  missingApiKeyMarker,
  missingApiKeyMessage,
  missingModelMessage,
  getDefaultModelId,
  getProviderDisplayName,
  isModelInCatalogForProvider,
  listSelectableProviderIds,
  providerCatalog,
  storyboardModelCatalog,
  storyboardModelPricing,
} from './providerCatalog';

import type { AiProviderId } from './providerCatalog';

export type AiTaskName =
  | 'sceneGrounding'
  | 'sceneBeats'
  | 'sceneStructure'
  | 'situationExtraction'
  | 'personaGeneration'
  | 'personaDialogue'
  | 'backgroundDescription'
  | 'backgroundFactConflicts'
  | 'sceneDraft'
  | 'sceneSkeleton'
  | 'sceneDialoguePolish'
  | 'sceneDialogueAttribution'
  | 'sceneSectionExpansion'
  | 'sceneBeatActor'
  | 'sceneBeatArbiter'
  | 'sceneBeatJudge'
  | 'traitsExtraction'
  | 'factExtraction'
  | 'cardFactExtraction'
  | 'cardFactVerification'
  | 'backgroundFactExtraction'
  | 'grammarCheck'
  | 'continuityCheck'
  | 'inlineCompletion'
  | 'draftExpansion'
  | 'draftAugment'
  | 'outlineSynopsis'
  | 'chapterPlan'
  | 'outlineCharacters'
  | 'draftCritique'
  | 'draftRevision'
  | 'chapterSummary'
  | 'storyStateUpdate'
  | 'sceneCoverage'
  | 'cardRecommendation'
  | 'storyCompletion'
  | 'storyCardBuild'
  | 'noteExtraction'
  | 'noteSynthesis'
  | 'noteCardConsolidation'
  | 'studioAgent'
  | 'studioValidation';

export interface AiTaskCatalogEntry {
  readonly name: AiTaskName;
  readonly label: string;
}

export const aiTaskCatalog: readonly AiTaskCatalogEntry[] = [
  { name: 'sceneGrounding', label: '씬 사실 시트' },
  { name: 'sceneBeats', label: '씬 비트 전개' },
  { name: 'sceneStructure', label: '씬 구조화' },
  { name: 'situationExtraction', label: '상황 추출' },
  { name: 'personaGeneration', label: '페르소나 생성' },
  { name: 'personaDialogue', label: '페르소나 대화 (사용 안 함)' },
  { name: 'backgroundDescription', label: '배경 묘사' },
  { name: 'backgroundFactConflicts', label: '배경 사실 상충 검사' },
  { name: 'sceneDraft', label: '씬 드래프트' },
  { name: 'sceneSkeleton', label: '씬 뼈대' },
  { name: 'sceneDialoguePolish', label: '대사 다듬기' },
  { name: 'sceneDialogueAttribution', label: '대사 화자 귀속' },
  { name: 'sceneSectionExpansion', label: '구간 살붙임' },
  { name: 'sceneBeatActor', label: '비트 배우 제안' },
  { name: 'sceneBeatArbiter', label: '비트 감독 합침' },
  { name: 'sceneBeatJudge', label: '비트 인물 심판' },
  { name: 'traitsExtraction', label: '특성 추출' },
  { name: 'factExtraction', label: '설정 사실 추출' },
  { name: 'cardFactExtraction', label: '카드 후보 추출' },
  { name: 'cardFactVerification', label: '카드 후보 검증' },
  { name: 'backgroundFactExtraction', label: '배경 사실 추출' },
  { name: 'grammarCheck', label: '문법 검사' },
  { name: 'continuityCheck', label: '연속성 검사' },
  { name: 'inlineCompletion', label: '인라인 완성' },
  { name: 'draftExpansion', label: '드래프트 확장' },
  { name: 'draftAugment', label: '초안 보충' },
  { name: 'outlineSynopsis', label: '시놉시스 생성' },
  { name: 'chapterPlan', label: '챕터 구성' },
  { name: 'outlineCharacters', label: '인물 카드 초안' },
  { name: 'draftCritique', label: '초안 비평' },
  { name: 'draftRevision', label: '초안 수정' },
  { name: 'chapterSummary', label: '장 요약' },
  { name: 'storyStateUpdate', label: '이야기 상태 갱신' },
  { name: 'sceneCoverage', label: '장면 커버리지 검사' },
  { name: 'cardRecommendation', label: '카드 추천' },
  { name: 'storyCompletion', label: '이야기 완결' },
  { name: 'storyCardBuild', label: '씬 기반 카드 구성' },
  { name: 'noteExtraction', label: '노트 분류·추출' },
  { name: 'noteSynthesis', label: '노트 계약·시놉시스 정리' },
  { name: 'noteCardConsolidation', label: '노트 카드 목록·별칭 정리' },
  { name: 'studioAgent', label: 'Studio 대화' },
  { name: 'studioValidation', label: 'Studio 정합성 검사' },
];

export const aiTaskNames: readonly [ AiTaskName, ...AiTaskName[], ] = aiTaskCatalog.map((task) => task.name) as unknown as readonly [
  AiTaskName,
  ...AiTaskName[],
];

export const aiTaskLabels: Readonly<Record<AiTaskName, string>> = Object.fromEntries(
  aiTaskCatalog.map((task) => [task.name, task.label]),
) as Readonly<Record<AiTaskName, string>>;

export interface UsageCacheAmount {
  readonly promptTokens: number;
  readonly cachedTokens: number;
  readonly savedUsd: number;
}

export interface UsageAmount {
  readonly costUsd: number;
  readonly tokens: number;
  readonly hasUnpricedUsage: boolean;
  readonly cache?: UsageCacheAmount;
}

export function usageCacheHitRate(amount: UsageAmount): number | undefined {
  const cache: UsageCacheAmount | undefined = amount.cache;
  return cache === undefined || cache.promptTokens <= 0 ? undefined : cache.cachedTokens / cache.promptTokens;
}

export interface UsageSummaryByEntity {
  readonly scenes: Readonly<Record<string, UsageAmount>>;
  readonly characters: Readonly<Record<string, UsageAmount>>;
  readonly backgrounds: Readonly<Record<string, UsageAmount>>;
  readonly total: UsageAmount;
}

export function emptyUsageAmount(): UsageAmount {
  return { costUsd: 0, tokens: 0, hasUnpricedUsage: false };
}

function addUsageCache(
  base: UsageCacheAmount | undefined,
  delta: UsageCacheAmount | undefined,
): UsageCacheAmount | undefined {
  if (base === undefined || delta === undefined) {
    return base ?? delta;
  }

  return {
    promptTokens: base.promptTokens + delta.promptTokens,
    cachedTokens: base.cachedTokens + delta.cachedTokens,
    savedUsd: base.savedUsd + delta.savedUsd,
  };
}

export function addUsageAmount(base: UsageAmount, delta: UsageAmount): UsageAmount {
  const cache: UsageCacheAmount | undefined = addUsageCache(base.cache, delta.cache);

  return {
    costUsd: base.costUsd + delta.costUsd,
    tokens: base.tokens + delta.tokens,
    hasUnpricedUsage: base.hasUnpricedUsage || delta.hasUnpricedUsage,
    ...(cache === undefined ? {} : { cache }),
  };
}

export function isAiProviderId(value: string): value is AiProviderId {
  return Object.hasOwn(providerCatalog, value);
}

export function requiresApiKey(providerId: AiProviderId): boolean {
  return providerCatalog[providerId].requiresApiKey;
}
