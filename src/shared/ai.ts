export const aiProviderIds = [
  'openai',
  'claude',
  'google',
  'ollama',
  'claude-code',
  'codex',
  'mock',
] as const;

export type AiProviderId = (typeof aiProviderIds)[number];

export const aiTaskCatalog = [
  { name: 'situationExtraction', label: '상황 추출', status: 'wired' },
  { name: 'personaGeneration', label: '페르소나 생성', status: 'wired' },
  { name: 'personaDialogue', label: '페르소나 대화', status: 'wired' },
  { name: 'backgroundDescription', label: '배경 묘사', status: 'wired' },
  { name: 'sceneDraft', label: '씬 드래프트', status: 'wired' },
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
  { name: 'sceneCoverage', label: '장면 커버리지 검사', status: 'wired' },
  { name: 'cardRecommendation', label: '카드 추천', status: 'wired' },
  { name: 'storyCompletion', label: '이야기 완결', status: 'wired' },
  { name: 'storyCardBuild', label: '씬 기반 카드 구성', status: 'wired' },
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

export interface UsageSummaryByEntity {
  readonly scenes: Readonly<Record<string, number>>;
  readonly characters: Readonly<Record<string, number>>;
  readonly backgrounds: Readonly<Record<string, number>>;
  readonly totalUsd: number;
}

export function isAiProviderId(value: string): value is AiProviderId {
  return aiProviderIds.includes(value as AiProviderId);
}

export function isCliProvider(providerId: AiProviderId): boolean {
  return providerId === 'claude-code' || providerId === 'codex';
}
