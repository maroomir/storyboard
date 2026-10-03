// 프로바이더 한 곳. 표시명·기본 모델·모델 목록·요금이 provider 마다 한 행이며,
// 아래의 파생 표들은 전부 이 행에서 나온다. 프로바이더를 추가할 때 고쳐야 하는 파일은 여기 하나다.

export type ProviderTransport = 'http' | 'mock';

export interface ProviderModelEntry {
  readonly id: string;
  readonly displayName: string;
  readonly inputPricePerMillion: number;
  readonly outputPricePerMillion: number;
  // 접두 캐시 요금. 프로바이더가 캐시 토큰을 입력과 따로 세는 경우에만 적는다(Claude).
  readonly cacheWritePricePerMillion?: number;
  readonly cacheReadPricePerMillion?: number;
  // 생략하면 true. 기본값이 아닌 temperature 를 400 으로 거부하거나 지원 중단한 모델만 false 로 적는다.
  readonly acceptsTemperature?: boolean;
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
    // 5.x 는 확인된 문구가 없다.
    models: [
      {
        id: 'gpt-6-sol',
        displayName: 'GPT-6 Sol',
        inputPricePerMillion: 2.0,
        outputPricePerMillion: 10.0,
        acceptsTemperature: false,
      },
      {
        id: 'gpt-6-astra',
        displayName: 'GPT-6 Astra',
        inputPricePerMillion: 10.0,
        outputPricePerMillion: 50.0,
        acceptsTemperature: false,
      },
      {
        id: 'gpt-6-luna',
        displayName: 'GPT-6 Luna',
        inputPricePerMillion: 0.1,
        outputPricePerMillion: 0.5,
        acceptsTemperature: false,
      },
      {
        id: 'gpt-5.6-terra',
        displayName: 'GPT-5.6 Terra',
        inputPricePerMillion: 2.0,
        outputPricePerMillion: 12.0,
      },
      {
        id: 'gpt-5.6-sol',
        displayName: 'GPT-5.6 Sol',
        inputPricePerMillion: 4.0,
        outputPricePerMillion: 20.0,
      },
      {
        id: 'gpt-5.5',
        displayName: 'GPT-5.5',
        inputPricePerMillion: 5.0,
        outputPricePerMillion: 30.0,
      },
      {
        id: 'gpt-5.6-luna',
        displayName: 'GPT-5.6 Luna',
        inputPricePerMillion: 0.2,
        outputPricePerMillion: 1.2,
      },
      {
        id: 'gpt-5.4-mini',
        displayName: 'GPT-5.4 mini',
        inputPricePerMillion: 0.75,
        outputPricePerMillion: 4.5,
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
    models: [
      {
        id: 'claude-sonnet-5',
        displayName: 'Claude Sonnet 5',
        inputPricePerMillion: 2.0,
        outputPricePerMillion: 10.0,
        ...claudeCachePrices(2.0),
        acceptsTemperature: false,
      },
      {
        id: 'claude-opus-5-5',
        displayName: 'Claude Opus 5.5',
        inputPricePerMillion: 4.0,
        outputPricePerMillion: 20.0,
        ...claudeCachePrices(4.0, 0.05),
        acceptsTemperature: false,
      },
      {
        id: 'claude-opus-5',
        displayName: 'Claude Opus 5',
        inputPricePerMillion: 5.0,
        outputPricePerMillion: 25.0,
        ...claudeCachePrices(5.0),
        acceptsTemperature: false,
      },
      {
        id: 'claude-fable-5-1',
        displayName: 'Claude Fable 5.1',
        inputPricePerMillion: 10.0,
        outputPricePerMillion: 50.0,
        ...claudeCachePrices(10.0, 0.025),
        acceptsTemperature: false,
      },
      {
        id: 'claude-opus-4-8',
        displayName: 'Claude Opus 4.8',
        inputPricePerMillion: 5.0,
        outputPricePerMillion: 25.0,
        acceptsTemperature: false,
      },
      {
        id: 'claude-sonnet-4-6',
        displayName: 'Claude Sonnet 4.6',
        inputPricePerMillion: 3.0,
        outputPricePerMillion: 15.0,
        ...claudeCachePrices(3.0),
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

// 작가가 고르는 목록. mock 은 개발용이라 빼되, 이미 mock 으로 설정된 값은 선택 상태가 사라지지
// 않도록 목록에 남긴다.
export function listSelectableProviderIds(currentProviderId?: AiProviderId): AiProviderId[] {
  return aiProviderIds.filter(
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
      catalogRows[providerId].models.map((model) => [
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
      ]),
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

// 프로바이더가 내는 네 가지 실패 문구. 여섯 클래스가 저마다 문장을 적으면 이름 표기가 갈라지고,
// 호스트가 «키가 없다»를 알아보려고 문구 조각을 손으로 베껴 두게 된다.
export const missingApiKeyMarker = 'API 키가 설정되어 있지 않습니다';

export function missingApiKeyMessage(providerId: AiProviderId): string {
  return `${getProviderDisplayName(providerId)} ${missingApiKeyMarker}.`;
}

export function missingModelMessage(providerId: AiProviderId): string {
  return `${getProviderDisplayName(providerId)} 모델이 설정되어 있지 않습니다.`;
}

export function connectionCheckFailedMessage(providerId: AiProviderId): string {
  return `${getProviderDisplayName(providerId)} 연결 확인에 실패했습니다.`;
}

export function generationFailedMessage(providerId: AiProviderId): string {
  return `${getProviderDisplayName(providerId)} 텍스트 생성에 실패했습니다.`;
}
