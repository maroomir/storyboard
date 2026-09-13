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

export const aiTaskCatalog = [
  { name: 'sceneGrounding', label: '씬 사실 시트', status: 'wired' },
  { name: 'sceneBeats', label: '씬 비트 전개', status: 'wired' },
  { name: 'sceneStructure', label: '씬 구조화', status: 'wired' },
  { name: 'situationExtraction', label: '상황 추출', status: 'wired' },
  { name: 'personaGeneration', label: '페르소나 생성', status: 'wired' },
  { name: 'personaDialogue', label: '페르소나 대화', status: 'wired' },
  { name: 'backgroundDescription', label: '배경 묘사', status: 'wired' },
  { name: 'sceneDraft', label: '씬 드래프트', status: 'wired' },
  { name: 'sceneSkeleton', label: '씬 뼈대', status: 'wired' },
  { name: 'sceneDialoguePolish', label: '대사 다듬기', status: 'wired' },
  { name: 'sceneDialogueAttribution', label: '대사 화자 귀속', status: 'wired' },
  { name: 'sceneSectionExpansion', label: '구간 살붙임', status: 'wired' },
  { name: 'traitsExtraction', label: '특성 추출', status: 'wired' },
  { name: 'factExtraction', label: '설정 사실 추출', status: 'wired' },
  { name: 'cardFactExtraction', label: '카드 후보 추출', status: 'wired' },
  { name: 'cardFactVerification', label: '카드 후보 검증', status: 'wired' },
  { name: 'backgroundFactExtraction', label: '배경 사실 추출', status: 'wired' },
  { name: 'grammarCheck', label: '문법 검사', status: 'wired' },
  { name: 'continuityCheck', label: '연속성 검사', status: 'wired' },
  { name: 'inlineCompletion', label: '인라인 완성', status: 'wired' },
  { name: 'draftExpansion', label: '드래프트 확장', status: 'wired' },
  { name: 'draftAugment', label: '초안 보충', status: 'wired' },
  { name: 'outlineSynopsis', label: '시놉시스 생성', status: 'wired' },
  { name: 'chapterPlan', label: '챕터 구성', status: 'wired' },
  { name: 'draftCritique', label: '초안 비평', status: 'wired' },
  { name: 'draftRevision', label: '초안 수정', status: 'wired' },
  { name: 'chapterSummary', label: '장 요약', status: 'wired' },
  { name: 'storyStateUpdate', label: '이야기 상태 갱신', status: 'wired' },
  { name: 'sceneCoverage', label: '장면 커버리지 검사', status: 'wired' },
  { name: 'cardRecommendation', label: '카드 추천', status: 'wired' },
  { name: 'storyCompletion', label: '이야기 완결', status: 'wired' },
  { name: 'storyCardBuild', label: '씬 기반 카드 구성', status: 'wired' },
  { name: 'studioAgent', label: 'Studio 대화', status: 'wired' },
  { name: 'studioValidation', label: 'Studio 정합성 검사', status: 'wired' },
] as const;

export type AiTaskCatalogEntry = (typeof aiTaskCatalog)[number];
export type AiTaskName = AiTaskCatalogEntry['name'];
export type AiTaskStatus = AiTaskCatalogEntry['status'];
export type WiredAiTaskName = Extract<AiTaskCatalogEntry, { readonly status: 'wired' }>['name'];

export const aiTaskNames = aiTaskCatalog.map((task) => task.name) as unknown as readonly [
  AiTaskName,
  ...AiTaskName[],
];

export const aiTaskLabels = Object.fromEntries(
  aiTaskCatalog.map((task) => [task.name, task.label]),
) as Readonly<Record<AiTaskName, string>>;

export interface UsageAmount {
  readonly costUsd: number;
  readonly tokens: number;
  readonly hasUnpricedUsage: boolean;
}

export interface UsageSummaryByEntity {
  readonly scenes: Readonly<Record<string, UsageAmount>>;
  readonly characters: Readonly<Record<string, UsageAmount>>;
  readonly backgrounds: Readonly<Record<string, UsageAmount>>;
  readonly total: UsageAmount;
}

export function isAiProviderId(value: string): value is AiProviderId {
  return Object.hasOwn(providerCatalog, value);
}

// ~/.storyboard/secrets.json 에 키가 필요한 쪽. 호스트마다 같은 질문을 다르게 답하지 않도록
// 카탈로그의 한 칸으로 판정한다.
export function requiresApiKey(providerId: AiProviderId): boolean {
  return providerCatalog[providerId].requiresApiKey;
}
