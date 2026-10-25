export type ProviderTransport = 'http' | 'cli' | 'oauth' | 'mock';

export interface ProviderModelEntry {
  readonly id: string;
  readonly displayName: string;
  readonly inputPricePerMillion?: number;
  readonly outputPricePerMillion?: number;
  readonly cacheWritePricePerMillion?: number;
  readonly cacheReadPricePerMillion?: number;
  readonly acceptsTemperature?: boolean;
  readonly acceptsReasoningEffort?: boolean;
  readonly acceptsMaxTokens?: boolean;
}

function claudeCachePrices(
  inputPricePerMillion: number,
  cacheReadMultiplier = 0.1,
): {
  readonly cacheWritePricePerMillion: number;
  readonly cacheReadPricePerMillion: number;
} {
  return {
    cacheWritePricePerMillion: inputPricePerMillion * 1.25,
    cacheReadPricePerMillion: inputPricePerMillion * cacheReadMultiplier,
  };
}

export interface ProviderCatalogEntry {
  readonly displayName: string;
  readonly transport: ProviderTransport;
  readonly requiresApiKey: boolean;
  readonly isHidden?: boolean;
  readonly defaultModel: string | undefined;
  readonly defaultBaseUrl: string | undefined;
  readonly models: readonly ProviderModelEntry[];
}

export const providerCatalog = {
  openai: {
    displayName: 'OpenAI',
    transport: 'http',
    requiresApiKey: true,
    defaultModel: 'gpt-6-sol',
    defaultBaseUrl: undefined,
    models: [
      {
        id: 'gpt-6-sol',
        displayName: 'GPT-6 Sol',
        inputPricePerMillion: 2.0,
        outputPricePerMillion: 10.0,
        acceptsTemperature: false,
        acceptsReasoningEffort: true,
      },
      {
        id: 'gpt-6-astra',
        displayName: 'GPT-6 Astra',
        inputPricePerMillion: 10.0,
        outputPricePerMillion: 50.0,
        acceptsTemperature: false,
        acceptsReasoningEffort: true,
      },
      {
        id: 'gpt-6-luna',
        displayName: 'GPT-6 Luna',
        inputPricePerMillion: 0.1,
        outputPricePerMillion: 0.5,
        acceptsTemperature: false,
        acceptsReasoningEffort: true,
      },
      {
        id: 'gpt-5.6-terra',
        displayName: 'GPT-5.6 Terra',
        inputPricePerMillion: 2.0,
        outputPricePerMillion: 12.0,
        acceptsReasoningEffort: true,
      },
      {
        id: 'gpt-5.6-sol',
        displayName: 'GPT-5.6 Sol',
        inputPricePerMillion: 4.0,
        outputPricePerMillion: 20.0,
        acceptsReasoningEffort: true,
      },
      {
        id: 'gpt-5.5',
        displayName: 'GPT-5.5',
        inputPricePerMillion: 5.0,
        outputPricePerMillion: 30.0,
        acceptsReasoningEffort: true,
      },
      {
        id: 'gpt-5.6-luna',
        displayName: 'GPT-5.6 Luna',
        inputPricePerMillion: 0.2,
        outputPricePerMillion: 1.2,
        acceptsReasoningEffort: true,
      },
      {
        id: 'gpt-5.4-mini',
        displayName: 'GPT-5.4 mini',
        inputPricePerMillion: 0.75,
        outputPricePerMillion: 4.5,
        acceptsReasoningEffort: true,
      },
    ],
  },
  claude: {
    displayName: 'Claude',
    transport: 'http',
    requiresApiKey: true,
    defaultModel: 'claude-sonnet-5',
    defaultBaseUrl: undefined,
    models: [
      {
        id: 'claude-sonnet-5',
        displayName: 'Claude Sonnet 5',
        inputPricePerMillion: 2.0,
        outputPricePerMillion: 10.0,
        ...claudeCachePrices(2.0),
        acceptsTemperature: false,
        acceptsReasoningEffort: true,
      },
      {
        id: 'claude-opus-5-5',
        displayName: 'Claude Opus 5.5',
        inputPricePerMillion: 4.0,
        outputPricePerMillion: 20.0,
        ...claudeCachePrices(4.0, 0.05),
        acceptsTemperature: false,
        acceptsReasoningEffort: true,
      },
      {
        id: 'claude-opus-5',
        displayName: 'Claude Opus 5',
        inputPricePerMillion: 5.0,
        outputPricePerMillion: 25.0,
        ...claudeCachePrices(5.0),
        acceptsTemperature: false,
        acceptsReasoningEffort: true,
      },
      {
        id: 'claude-fable-5-1',
        displayName: 'Claude Fable 5.1',
        inputPricePerMillion: 10.0,
        outputPricePerMillion: 50.0,
        ...claudeCachePrices(10.0, 0.025),
        acceptsTemperature: false,
        acceptsReasoningEffort: true,
      },
      {
        id: 'claude-opus-4-8',
        displayName: 'Claude Opus 4.8',
        inputPricePerMillion: 5.0,
        outputPricePerMillion: 25.0,
        acceptsTemperature: false,
        acceptsReasoningEffort: true,
      },
      {
        id: 'claude-sonnet-4-6',
        displayName: 'Claude Sonnet 4.6',
        inputPricePerMillion: 3.0,
        outputPricePerMillion: 15.0,
        ...claudeCachePrices(3.0),
        acceptsReasoningEffort: true,
      },
      {
        id: 'claude-haiku-4-5',
        displayName: 'Claude Haiku 4.5',
        inputPricePerMillion: 1.0,
        outputPricePerMillion: 5.0,
        ...claudeCachePrices(1.0),
      },
    ],
  },
  google: {
    displayName: 'Google Gemini',
    transport: 'http',
    requiresApiKey: true,
    defaultModel: 'gemini-3.8-flash',
    defaultBaseUrl: undefined,
    models: [
      {
        id: 'gemini-3.8-flash',
        displayName: 'Gemini 3.8 Flash',
        inputPricePerMillion: 0.75,
        outputPricePerMillion: 3.75,
        acceptsTemperature: false,
      },
      {
        id: 'gemini-3.1-pro-preview',
        displayName: 'Gemini 3.1 Pro (Preview)',
        inputPricePerMillion: 2.0,
        outputPricePerMillion: 12.0,
        acceptsTemperature: false,
      },
      {
        id: 'gemini-2.5-pro',
        displayName: 'Gemini 2.5 Pro',
        inputPricePerMillion: 1.25,
        outputPricePerMillion: 10.0,
      },
      {
        id: 'gemini-3.5-flash-lite',
        displayName: 'Gemini 3.5 Flash-Lite',
        inputPricePerMillion: 0.3,
        outputPricePerMillion: 2.5,
        acceptsTemperature: false,
      },
      {
        id: 'gemini-2.5-flash',
        displayName: 'Gemini 2.5 Flash',
        inputPricePerMillion: 0.3,
        outputPricePerMillion: 2.5,
      },
      {
        id: 'gemini-2.5-flash-lite',
        displayName: 'Gemini 2.5 Flash-Lite',
        inputPricePerMillion: 0.1,
        outputPricePerMillion: 0.4,
      },
    ],
  },
  grok: {
    displayName: 'xAI Grok',
    transport: 'http',
    requiresApiKey: true,
    defaultModel: 'grok-4.7',
    defaultBaseUrl: 'https://api.x.ai/v1',
    models: [
      {
        id: 'grok-4.7',
        displayName: 'Grok 4.7',
        inputPricePerMillion: 2.0,
        outputPricePerMillion: 6.0,
      },
      {
        id: 'grok-4.6',
        displayName: 'Grok 4.6',
        inputPricePerMillion: 2.0,
        outputPricePerMillion: 6.0,
      },
      {
        id: 'grok-4.5',
        displayName: 'Grok 4.5',
        inputPricePerMillion: 2.0,
        outputPricePerMillion: 6.0,
      },
      {
        id: 'grok-4.3',
        displayName: 'Grok 4.3',
        inputPricePerMillion: 1.25,
        outputPricePerMillion: 2.5,
      },
      {
        id: 'grok-4.20-0309-reasoning',
        displayName: 'Grok 4.20 (추론)',
        inputPricePerMillion: 1.25,
        outputPricePerMillion: 2.5,
      },
      {
        id: 'grok-4.20-0309-non-reasoning',
        displayName: 'Grok 4.20 (비추론)',
        inputPricePerMillion: 1.25,
        outputPricePerMillion: 2.5,
      },
    ],
  },
  ollama: {
    displayName: 'Ollama',
    transport: 'http',
    requiresApiKey: false,
    defaultModel: 'gemma4:12b',
    defaultBaseUrl: 'http://localhost:11434',
    models: [
      {
        id: 'gemma4:12b',
        displayName: 'Gemma 4 12B (12GB GPU 기본)',
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
      },
      {
        id: 'qwen3.5:9b',
        displayName: 'Qwen 3.5 9B (8GB GPU)',
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
      },
      {
        id: 'exaone3.5:7.8b',
        displayName: 'EXAONE 3.5 7.8B (한국어 명시, 문맥 32K)',
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
      },
      {
        id: 'gpt-oss:20b',
        displayName: 'gpt-oss 20B (16GB GPU)',
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
      },
      {
        id: 'qwen3.8:27b',
        displayName: 'Qwen 3.8 27B (24GB GPU)',
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
      },
      {
        id: 'gemma4:26b',
        displayName: 'Gemma 4 26B (24GB GPU, MoE)',
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
      },
    ],
  },
  'claude-code': {
    displayName: 'Claude (구독 로그인)',
    transport: 'cli',
    requiresApiKey: false,
    isHidden: true,
    defaultModel: 'claude-sonnet-5',
    defaultBaseUrl: undefined,
    models: [
      {
        id: 'claude-sonnet-5',
        displayName: 'Claude Sonnet 5',
        acceptsTemperature: false,
        acceptsReasoningEffort: true,
      },
      {
        id: 'claude-opus-5-5',
        displayName: 'Claude Opus 5.5',
        acceptsTemperature: false,
        acceptsReasoningEffort: true,
      },
      { id: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5', acceptsTemperature: false },
    ],
  },
  chatgpt: {
    displayName: 'ChatGPT (구독 로그인, 미리보기)',
    transport: 'oauth',
    requiresApiKey: false,
    isHidden: true,
    defaultModel: 'gpt-6-sol',
    defaultBaseUrl: 'https://api.openai.com/v1',
    models: [
      {
        id: 'gpt-6-sol',
        displayName: 'GPT-6 Sol',
        acceptsTemperature: false,
        acceptsReasoningEffort: true,
        acceptsMaxTokens: false,
      },
      {
        id: 'gpt-6-astra',
        displayName: 'GPT-6 Astra',
        acceptsTemperature: false,
        acceptsReasoningEffort: true,
        acceptsMaxTokens: false,
      },
      {
        id: 'gpt-6-luna',
        displayName: 'GPT-6 Luna',
        acceptsTemperature: false,
        acceptsReasoningEffort: true,
        acceptsMaxTokens: false,
      },
      {
        id: 'gpt-5.6-terra',
        displayName: 'GPT-5.6 Terra',
        acceptsTemperature: false,
        acceptsReasoningEffort: true,
        acceptsMaxTokens: false,
      },
      {
        id: 'gpt-5.6-sol',
        displayName: 'GPT-5.6 Sol',
        acceptsTemperature: false,
        acceptsReasoningEffort: true,
        acceptsMaxTokens: false,
      },
      {
        id: 'gpt-5.6-luna',
        displayName: 'GPT-5.6 Luna',
        acceptsTemperature: false,
        acceptsReasoningEffort: true,
        acceptsMaxTokens: false,
      },
    ],
  },
  mock: {
    displayName: 'Mock AI',
    transport: 'mock',
    requiresApiKey: false,
    defaultModel: undefined,
    defaultBaseUrl: undefined,
    models: [
      {
        id: 'mock-default',
        displayName: 'Mock (offline)',
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
      },
    ],
  },
} as const satisfies Record<string, ProviderCatalogEntry>;

export type AiProviderId = keyof typeof providerCatalog;

export const aiProviderIds: readonly [AiProviderId, ...AiProviderId[]] = Object.keys(
  providerCatalog,
) as unknown as readonly [AiProviderId, ...AiProviderId[]];

const catalogRows: Readonly<Record<AiProviderId, ProviderCatalogEntry>> = providerCatalog;

export function isHiddenProvider(providerId: AiProviderId): boolean {
  return catalogRows[providerId].isHidden === true;
}

export const hiddenProviderIds: readonly AiProviderId[] = aiProviderIds.filter(isHiddenProvider);

export function hiddenProviderEnabledKey(providerId: AiProviderId): string {
  return `providers.${providerId}.enabled`;
}

export function hiddenProviderRiskAcknowledgedKey(providerId: AiProviderId): string {
  return `providers.${providerId}.riskAcknowledged`;
}

export function listAvailableProviderIds(
  enabledHiddenProviderIds: readonly AiProviderId[] = [],
): AiProviderId[] {
  return aiProviderIds.filter(
    (providerId) => !isHiddenProvider(providerId) || enabledHiddenProviderIds.includes(providerId),
  );
}

export function listSelectableProviderIds(
  currentProviderId?: AiProviderId,
  enabledHiddenProviderIds: readonly AiProviderId[] = [],
): AiProviderId[] {
  return listAvailableProviderIds(enabledHiddenProviderIds).filter(
    (providerId) =>
      catalogRows[providerId].transport !== 'mock' || providerId === currentProviderId,
  );
}

export interface ProviderModelOption {
  readonly id: string;
  readonly displayName: string;
}

export type ProviderModelOptions = readonly [ProviderModelOption, ...ProviderModelOption[]];

export interface ModelPricePerMillion {
  readonly inputPricePerMillion: number;
  readonly outputPricePerMillion: number;
  readonly cacheWritePricePerMillion?: number;
  readonly cacheReadPricePerMillion?: number;
}

export const storyboardModelCatalog: Readonly<Record<AiProviderId, ProviderModelOptions>> =
  Object.fromEntries(
    aiProviderIds.map((providerId) => [
      providerId,
      catalogRows[providerId].models.map((model) => ({
        id: model.id,
        displayName: model.displayName,
      })),
    ]),
  ) as unknown as Readonly<Record<AiProviderId, ProviderModelOptions>>;

export const storyboardModelPricing: Readonly<
  Record<AiProviderId, Readonly<Record<string, ModelPricePerMillion>>>
> = Object.fromEntries(
  aiProviderIds.map((providerId) => [
    providerId,
    Object.fromEntries(
      catalogRows[providerId].models.flatMap((model) =>
        model.inputPricePerMillion === undefined || model.outputPricePerMillion === undefined
          ? []
          : [
              [
                model.id,
                {
                  inputPricePerMillion: model.inputPricePerMillion,
                  outputPricePerMillion: model.outputPricePerMillion,
                  ...(model.cacheWritePricePerMillion === undefined
                    ? {}
                    : { cacheWritePricePerMillion: model.cacheWritePricePerMillion }),
                  ...(model.cacheReadPricePerMillion === undefined
                    ? {}
                    : { cacheReadPricePerMillion: model.cacheReadPricePerMillion }),
                },
              ],
            ],
      ),
    ),
  ]),
) as unknown as Readonly<Record<AiProviderId, Readonly<Record<string, ModelPricePerMillion>>>>;

export function getProviderDisplayName(providerId: AiProviderId): string {
  return providerCatalog[providerId].displayName;
}

export function getDefaultModelId(providerId: AiProviderId): string | undefined {
  return providerCatalog[providerId].defaultModel;
}

export function isModelInCatalogForProvider(providerId: AiProviderId, modelId: string): boolean {
  return catalogRows[providerId].models.some((model) => model.id === modelId);
}

export function acceptsTemperature(providerId: AiProviderId, modelId: string): boolean {
  const model: ProviderModelEntry | undefined = catalogRows[providerId].models.find(
    (entry) => entry.id === modelId,
  );
  return model?.acceptsTemperature !== false;
}

export function acceptsReasoningEffort(providerId: AiProviderId, modelId: string): boolean {
  const model: ProviderModelEntry | undefined = catalogRows[providerId].models.find(
    (entry) => entry.id === modelId,
  );
  return model?.acceptsReasoningEffort === true;
}

export function acceptsMaxTokens(providerId: AiProviderId, modelId: string): boolean {
  const model: ProviderModelEntry | undefined = catalogRows[providerId].models.find(
    (entry) => entry.id === modelId,
  );
  return model?.acceptsMaxTokens !== false;
}

export function getProviderTransport(providerId: AiProviderId): ProviderTransport {
  return catalogRows[providerId].transport;
}

export function requiresSubscriptionRiskNotice(providerId: AiProviderId): boolean {
  return isHiddenProvider(providerId) && catalogRows[providerId].transport === 'cli';
}

export const missingApiKeyMarker: string = 'API 키가 설정되어 있지 않습니다';

export function missingApiKeyMessage(providerId: AiProviderId): string {
  return `${getProviderDisplayName(providerId)} ${missingApiKeyMarker}.`;
}

export function missingModelMessage(providerId: AiProviderId): string {
  return `${getProviderDisplayName(providerId)} 모델이 설정되어 있지 않습니다.`;
}

function withProviderErrorDetail(message: string, cause: unknown): string {
  const detail: string =
    cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
  const singleLineDetail: string = detail.replace(/\s+/g, ' ').trim();

  return singleLineDetail ? `${message}: ${singleLineDetail}` : `${message}.`;
}

export function connectionCheckFailedMessage(providerId: AiProviderId, cause?: unknown): string {
  return withProviderErrorDetail(
    `${getProviderDisplayName(providerId)} 연결 확인에 실패했습니다`,
    cause,
  );
}

export function generationFailedMessage(providerId: AiProviderId, cause?: unknown): string {
  return withProviderErrorDetail(
    `${getProviderDisplayName(providerId)} 텍스트 생성에 실패했습니다`,
    cause,
  );
}

export const subscriptionRiskNoticeTitle: string = '구독 로그인으로 생성하기 전에 확인해 주세요.';

export interface SubscriptionRiskNoticeItem {
  readonly title: string;
  readonly detail: string;
}

export const subscriptionRiskNoticeItems: readonly SubscriptionRiskNoticeItem[] = [
  {
    title: '구독 한도를 함께 씁니다.',
    detail:
      '씬 하나에 수십 번 호출합니다. 한도가 차면 같은 계정의 다른 작업도 한도가 풀릴 때까지 멈춥니다.',
  },
  {
    title: '계정이 제한될 수 있습니다.',
    detail:
      '구독은 «통상적인 개인 사용»을 전제로 합니다. 자동·대량 호출로 판단되면 제공자가 계정을 제한·정지할 수 있습니다.',
  },
  {
    title: '예고 없이 멈출 수 있습니다.',
    detail:
      'claude 실행 파일의 동작이 바뀌면 로그인을 읽지 못해 이 경로 전체가 동작하지 않게 됩니다.',
  },
  {
    title: '예산이 멈춰 주지 않습니다.',
    detail: '금액이 계산되지 않아 실행 예산이 적용되지 않고, 토큰 수만 표시됩니다.',
  },
  {
    title: '실험 기능입니다.',
    detail: '지원 대상이 아니며 언제든 빠질 수 있습니다.',
  },
];

export const subscriptionRiskNoticeQuestion: string = '이 위험을 이해했고 내 책임으로 켭니다.';

export function formatSubscriptionRiskNotice(): string {
  const items: string[] = subscriptionRiskNoticeItems.flatMap((item, index) => [
    `${index + 1}. ${item.title}`,
    `   ${item.detail}`,
  ]);

  return [subscriptionRiskNoticeTitle, '', ...items].join('\n');
}

export const subscriptionRiskWarning: string =
  '구독 로그인으로 생성합니다 — 구독 한도를 쓰고, 실행 예산이 적용되지 않으며, 예고 없이 멈출 수 있습니다.';

export const planUsagePreviewWarning: string =
  '구독 로그인(미리보기)으로 생성합니다 — 사용량은 ChatGPT 구독 한도에서 나가고, 금액이 계산되지 않아 실행 예산이 적용되지 않습니다. 한도에 닿으면 씬 경계에서 멈춥니다.';

export function hiddenProviderRunWarning(providerId: AiProviderId): string {
  return requiresSubscriptionRiskNotice(providerId)
    ? subscriptionRiskWarning
    : planUsagePreviewWarning;
}

export const planUsageSettingsUrl: string = 'https://chatgpt.com/settings/usage';

export function loginRequiredMessage(providerId: AiProviderId): string {
  return `${getProviderDisplayName(providerId)} 에 로그인돼 있지 않습니다. \`storyboard login ${providerId}\` 로 로그인하세요.`;
}

export function usageLimitMessage(providerId: AiProviderId): string {
  return `${getProviderDisplayName(providerId)} 사용 한도에 닿아 멈췄습니다. ChatGPT 설정 › Usage(${planUsageSettingsUrl})에서 이 앱의 한도와 남은 양을 확인하세요.`;
}

export function unknownProviderMessage(providerId: string): string {
  return `알 수 없는 프로바이더: ${providerId}`;
}

export function riskNotAcknowledgedMessage(providerId: AiProviderId): string {
  return `${getProviderDisplayName(providerId)} 경로의 위험 고지에 아직 동의하지 않았습니다. \`storyboard config set ${hiddenProviderEnabledKey(providerId)} true\` 로 고지를 읽고 동의한 뒤 다시 시도하세요.`;
}
