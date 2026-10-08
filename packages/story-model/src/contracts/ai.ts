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

export const aiTaskCatalog = [
  { name: 'sceneGrounding', label: '씬 사실 시트' },
  { name: 'sceneBeats', label: '씬 비트 전개' },
  { name: 'sceneStructure', label: '씬 구조화' },
  { name: 'situationExtraction', label: '상황 추출' },
  { name: 'personaGeneration', label: '페르소나 생성' },
  // NOTE: 비트별 즉흥 대화(뼈대 구조 이전)의 작업 이름. 프롬프트와 호출은 없어졌지만 옛 사용량
  // 원장·설정 파일이 이 이름을 담고 있어 enum 에서 빼면 그 파일들이 읽히지 않는다.
  { name: 'personaDialogue', label: '페르소나 대화 (사용 안 함)' },
  { name: 'backgroundDescription', label: '배경 묘사' },
  { name: 'sceneDraft', label: '씬 드래프트' },
  { name: 'sceneSkeleton', label: '씬 뼈대' },
  { name: 'sceneDialoguePolish', label: '대사 다듬기' },
  { name: 'sceneDialogueAttribution', label: '대사 화자 귀속' },
  { name: 'sceneSectionExpansion', label: '구간 살붙임' },
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
] as const;

export type AiTaskCatalogEntry = (typeof aiTaskCatalog)[number];
export type AiTaskName = AiTaskCatalogEntry['name'];

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
