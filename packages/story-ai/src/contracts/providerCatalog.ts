// 프로바이더 한 곳. 표시명·기본 모델·모델 목록·요금이 provider 마다 한 행이며,
// 아래의 파생 표들은 전부 이 행에서 나온다. 프로바이더를 추가할 때 고쳐야 하는 파일은 여기 하나다.

export type ProviderTransport = 'http' | 'mock';

export interface ProviderModelEntry {
  readonly id: string;
  readonly displayName: string;
  readonly inputPricePerMillion: number;
  readonly outputPricePerMillion: number;
}

export interface ProviderCatalogEntry {
  readonly displayName: string;
  readonly transport: ProviderTransport;
  readonly requiresApiKey: boolean;
  readonly defaultModel: string | undefined;
  readonly defaultBaseUrl: string | undefined;
  readonly models: readonly ProviderModelEntry[];
}

export const providerCatalog = {
  openai: {
    displayName: 'OpenAI',
    transport: 'http',
    requiresApiKey: true,
    defaultModel: 'gpt-5.4-mini',
    defaultBaseUrl: undefined,
    models: [
      {
        id: 'gpt-5.4-mini',
        displayName: 'GPT-5.4 mini',
        inputPricePerMillion: 0.25,
        outputPricePerMillion: 2.0,
      },
      {
        id: 'gpt-5-mini',
        displayName: 'GPT-5 mini',
        inputPricePerMillion: 0.15,
        outputPricePerMillion: 0.6,
      },
      {
        id: 'gpt-5-nano',
        displayName: 'GPT-5 nano',
        inputPricePerMillion: 0.05,
        outputPricePerMillion: 0.2,
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
      },
      {
        id: 'claude-sonnet-4-6',
        displayName: 'Claude Sonnet 4.6',
        inputPricePerMillion: 3.0,
        outputPricePerMillion: 15.0,
      },
      {
        id: 'claude-sonnet-4-5',
        displayName: 'Claude Sonnet 4.5',
        inputPricePerMillion: 3.0,
        outputPricePerMillion: 15.0,
      },
      {
        id: 'claude-haiku-4-5',
        displayName: 'Claude Haiku 4.5',
        inputPricePerMillion: 1.0,
        outputPricePerMillion: 5.0,
      },
    ],
  },
  google: {
    displayName: 'Google Gemini',
    transport: 'http',
    requiresApiKey: true,
    defaultModel: 'gemini-2.5-flash',
    defaultBaseUrl: undefined,
    models: [
      {
        id: 'gemini-2.5-flash',
        displayName: 'Gemini 2.5 Flash',
        inputPricePerMillion: 0.075,
        outputPricePerMillion: 0.3,
      },
      {
        id: 'gemini-2.5-pro',
        displayName: 'Gemini 2.5 Pro',
        inputPricePerMillion: 1.25,
        outputPricePerMillion: 10.0,
      },
      {
        id: 'gemini-2.5-flash-lite',
        displayName: 'Gemini 2.5 Flash-Lite',
        inputPricePerMillion: 0.05,
        outputPricePerMillion: 0.2,
      },
    ],
  },
  grok: {
    displayName: 'xAI Grok',
    transport: 'http',
    requiresApiKey: true,
    defaultModel: 'grok-4.6',
    defaultBaseUrl: 'https://api.x.ai/v1',
    // NOTE: docs.x.ai/docs/models 2026-09 기준, 프롬프트 200k 토큰 미만 요금.
    models: [
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
    ],
  },
  ollama: {
    displayName: 'Ollama',
    transport: 'http',
    requiresApiKey: false,
    // NOTE: 로컬은 받아 둔 모델이 기계마다 다르므로 이 목록은 고정 목록이 아니라 제안이다.
    // 목록에 없는 이름도 그대로 받는다 — 진짜 목록은 ollama 가 갖고 있다.
    defaultModel: 'qwen3:8b',
    defaultBaseUrl: 'http://localhost:11434',
    models: [
      {
        id: 'qwen3:8b',
        displayName: 'Qwen 3 8B (12GB에서 긴 문맥까지)',
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
      },
      {
        id: 'qwen3:14b',
        displayName: 'Qwen 3 14B (한국어 산문 우선)',
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
      },
      {
        id: 'gemma3:12b',
        displayName: 'Gemma 3 12B (심판용, 생성과 다른 계열)',
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
      },
      {
        id: 'llama3.3',
        displayName: 'Llama 3.3',
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
      },
      {
        id: 'llama3.2',
        displayName: 'Llama 3.2',
        inputPricePerMillion: 0,
        outputPricePerMillion: 0,
      },
      {
        id: 'qwen2.5',
        displayName: 'Qwen 2.5',
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
