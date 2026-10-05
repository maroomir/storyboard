// 프로바이더 한 곳. 표시명·기본 모델·모델 목록·요금이 provider 마다 한 행이며,
// 아래의 파생 표들은 전부 이 행에서 나온다. 프로바이더를 추가할 때 고쳐야 하는 파일은 여기 하나다.

export type ProviderTransport = 'http' | 'cli' | 'mock';

export interface ProviderModelEntry {
  readonly id: string;
  readonly displayName: string;
  // 구독 로그인으로 부르는 모델(transport 'cli')만 비운다. 요금이 없는 호출은 0 이 아니라 «모름» 이다.
  readonly inputPricePerMillion?: number;
  readonly outputPricePerMillion?: number;
  // 접두 캐시 요금. 프로바이더가 캐시 토큰을 입력과 따로 세는 경우에만 적는다(Claude).
  readonly cacheWritePricePerMillion?: number;
  readonly cacheReadPricePerMillion?: number;
  // 생략하면 true. 기본값이 아닌 temperature 를 400 으로 거부하거나 지원 중단한 모델만 false 로 적는다.
  readonly acceptsTemperature?: boolean;
  // 생략하면 false. 사고 강도(Claude output_config.effort, OpenAI reasoning_effort)의 low·medium·high
  // 를 받는다고 공식 문서가 밝힌 모델만 true 로 적는다. 받지 않는 모델은 400 을 낸다.
  readonly acceptsReasoningEffort?: boolean;
}

// Claude 접두 캐시: 쓰기는 입력 요금의 1.25배, 읽기는 0.1배(5분 캐시 기준). Opus 5.5(0.05배)와
// Fable 5.1(0.025배)은 읽기 배율이 다르므로 행에 직접 적는다.
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
  // 목록·도움말·완성 어디에도 나오지 않고, 홈 설정의 `providers.<id>.enabled` 가 켜져야만 쓸 수 있다.
  readonly isHidden?: boolean;
  readonly defaultModel: string | undefined;
  readonly defaultBaseUrl: string | undefined;
  readonly models: readonly ProviderModelEntry[];
}

// NOTE: 모델·요금은 각 사의 공식 모델·요금 문서 2026-09-27 기준이다. 요금은 표준 등급, 긴 프롬프트
// 할증이 있는 모델은 할증 전 구간 값이다.
export const providerCatalog = {
  openai: {
    displayName: 'OpenAI',
    transport: 'http',
    requiresApiKey: true,
    defaultModel: 'gpt-6-sol',
    defaultBaseUrl: undefined,
    // NOTE: OpenAI 최신 모델 안내가 GPT-6 세대(Astra·Sol·Luna)는 temperature·top_p 를 빼라고 명시한다.
    // 5.x 는 확인된 문구가 없다. 사고 강도는 GPT-5 모델 문서가 minimal~high, GPT-6 안내가 low~max 를
    // 받는다고 밝힌다(2026-10-04 확인).
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
    // NOTE: Claude 4.7 이후 모델은 기본값이 아닌 temperature·top_p·top_k 를 400 으로 거부한다.
    // NOTE: 사고 강도(output_config.effort)는 Opus·Sonnet 4.6 이후와 Fable 이 받고 Haiku 4.5 는 400 을
    // 낸다(Claude API 문서, 2026-10-04 확인).
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
    // NOTE: 3.x 세대는 temperature 를 지원 중단했다. 3.8 Flash 요금은 2026-12-31까지의 도입가이며
    // 2027-01-01부터 두 배($1.50/$7.50)가 된다.
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
    // NOTE: docs.x.ai/developers/models 2026-09-27 기준, 프롬프트 200k 토큰 미만 요금.
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
    // NOTE: 로컬은 받아 둔 모델이 기계마다 다르므로 이 목록은 고정 목록이 아니라 제안이다.
    // 목록에 없는 이름도 그대로 받는다 — 진짜 목록은 ollama 가 갖고 있다.
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
  // NOTE: 사용자가 직접 설치하고 자기 구독으로 로그인한 공식 `claude` 실행 파일을 그대로 부른다.
  // 인증 정보는 읽지도 넘기지도 않는다. 온도·시드 플래그는 없고, 사고 강도는 `--effort` 로 받는다
  // (2.1.289, 2026-10-05 실측 — Haiku 는 재지 않아 API 행과 같게 비워 둔다).
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

export const aiProviderIds = Object.keys(providerCatalog) as unknown as readonly [
  AiProviderId,
  ...AiProviderId[],
];

// `as const` 는 행마다 실제로 적힌 필드만 남기므로, 선택 필드를 읽는 파생 표는 선언된 모양으로
// 한 번 넓혀서 읽는다.
const catalogRows: Readonly<Record<AiProviderId, ProviderCatalogEntry>> = providerCatalog;

export function isHiddenProvider(providerId: AiProviderId): boolean {
  return catalogRows[providerId].isHidden === true;
}

export const hiddenProviderIds: readonly AiProviderId[] = aiProviderIds.filter(isHiddenProvider);

// 숨은 프로바이더를 켜는 키와, 위험 고지에 동의했다는 기록. 둘 다 홈 설정 파일에서만 읽는다 —
// 구독은 사람에게 묶인 것이라, 남이 준 작품의 설정이 내 구독을 켜서는 안 된다.
export function hiddenProviderEnabledKey(providerId: AiProviderId): string {
  return `providers.${providerId}.enabled`;
}

export function hiddenProviderRiskAcknowledgedKey(providerId: AiProviderId): string {
  return `providers.${providerId}.riskAcknowledged`;
}

// 사람에게 이름을 보여 주거나 받은 이름을 검사하는 곳이 쓰는 목록. 켜지 않은 숨은 프로바이더는
// 없는 이름이다.
export function listAvailableProviderIds(
  enabledHiddenProviderIds: readonly AiProviderId[] = [],
): AiProviderId[] {
  return aiProviderIds.filter(
    (providerId) => !isHiddenProvider(providerId) || enabledHiddenProviderIds.includes(providerId),
  );
}

// 작가가 고르는 목록. mock 은 개발용이라 빼되, 이미 mock 으로 설정된 값은 선택 상태가 사라지지
// 않도록 목록에 남긴다.
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

// 모든 프로바이더는 모델을 적어도 하나 갖는다. 그 사실을 타입으로 적어야 «목록의 첫 모델»을
// 읽는 쪽이 없는 경우를 방어하지 않아도 된다.
export type ProviderModelOptions = readonly [ProviderModelOption, ...ProviderModelOption[]];

export interface ModelPricePerMillion {
  readonly inputPricePerMillion: number;
  readonly outputPricePerMillion: number;
  readonly cacheWritePricePerMillion?: number;
  readonly cacheReadPricePerMillion?: number;
}

export const storyboardModelCatalog = Object.fromEntries(
  aiProviderIds.map((providerId) => [
    providerId,
    catalogRows[providerId].models.map((model) => ({
      id: model.id,
      displayName: model.displayName,
    })),
  ]),
) as unknown as Readonly<Record<AiProviderId, ProviderModelOptions>>;

export const storyboardModelPricing = Object.fromEntries(
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

// 카탈로그에 없는 모델(로컬 ollama 태그 등)은 temperature 를 받는다고 본다 — 거부가 확인된 모델만 뺀다.
export function acceptsTemperature(providerId: AiProviderId, modelId: string): boolean {
  const model = catalogRows[providerId].models.find((entry) => entry.id === modelId);
  return model?.acceptsTemperature !== false;
}

export function acceptsReasoningEffort(providerId: AiProviderId, modelId: string): boolean {
  const model = catalogRows[providerId].models.find((entry) => entry.id === modelId);
  return model?.acceptsReasoningEffort === true;
}

// 프로바이더가 내는 네 가지 실패 문구. 여섯 클래스가 저마다 문장을 적으면 이름 표기가 갈라지고,
// 호스트가 «키가 없다»를 알아보려고 문구 조각을 손으로 베껴 두게 된다.
export const missingApiKeyMarker = 'API 키가 설정되어 있지 않습니다';

export function missingApiKeyMessage(providerId: AiProviderId): string {
  return `${getProviderDisplayName(providerId)} ${missingApiKeyMarker}.`;
}

export function missingModelMessage(providerId: AiProviderId): string {
  return `${getProviderDisplayName(providerId)} 모델이 설정되어 있지 않습니다.`;
}

// The provider's own words (status, quota, rejected parameter) are what a person can act on.
function withProviderErrorDetail(message: string, cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
  const singleLineDetail = detail.replace(/\s+/g, ' ').trim();

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

// 구독 로그인 경로를 켜기 전에 사람이 읽고 답하는 고지문. 세 앱이 같은 글을 보여 준다.
export const subscriptionRiskNoticeTitle = '구독 로그인으로 생성하기 전에 확인해 주세요.';

export const subscriptionRiskNoticeItems = [
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
] as const;

export const subscriptionRiskNoticeQuestion = '이 위험을 이해했고 내 책임으로 켭니다.';

export function formatSubscriptionRiskNotice(): string {
  const items = subscriptionRiskNoticeItems.flatMap((item, index) => [
    `${index + 1}. ${item.title}`,
    `   ${item.detail}`,
  ]);

  return [subscriptionRiskNoticeTitle, '', ...items].join('\n');
}

export const subscriptionRiskWarning =
  '구독 로그인으로 생성합니다 — 구독 한도를 쓰고, 실행 예산이 적용되지 않으며, 예고 없이 멈출 수 있습니다.';

export function unknownProviderMessage(providerId: string): string {
  return `알 수 없는 프로바이더: ${providerId}`;
}

export function riskNotAcknowledgedMessage(providerId: AiProviderId): string {
  return `${getProviderDisplayName(providerId)} 경로의 위험 고지에 아직 동의하지 않았습니다. \`storyboard config set ${hiddenProviderEnabledKey(providerId)} true\` 로 고지를 읽고 동의한 뒤 다시 시도하세요.`;
}
