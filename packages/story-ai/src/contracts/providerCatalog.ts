// 프로바이더 한 곳. 표시명·기본 모델·기본 실행 명령·모델 목록·요금이 provider 마다 한 행이며,
// 아래의 파생 표들은 전부 이 행에서 나온다. 프로바이더를 추가할 때 고쳐야 하는 파일은 여기 하나다.

export type ProviderTransport = 'http' | 'cli' | 'mock';

export interface ProviderModelEntry {
  readonly id: string;
  readonly displayName: string;
  // 구독형 CLI 는 토큰당 과금이 아니므로 값이 없다. 없으면 요금표에서 그 모델이 빠진다.
  readonly inputPricePerMillion?: number;
  readonly outputPricePerMillion?: number;
}

export interface ProviderCatalogEntry {
  readonly displayName: string;
  readonly transport: ProviderTransport;
  readonly requiresApiKey: boolean;
  readonly defaultModel: string | undefined;
  readonly defaultCommand: string | undefined;
  readonly defaultBaseUrl: string | undefined;
  // CLI 백엔드에서 사라진 모델 id. 옛 설정이 죽은 모델로 호출을 보내지 않도록 기본값으로 되돌린다.
  readonly retiredModelIds: readonly string[];
  readonly models: readonly ProviderModelEntry[];
}

export const providerCatalog = {
  openai: {
    displayName: 'OpenAI',
    transport: 'http',
    requiresApiKey: true,
    defaultModel: 'gpt-5.4-mini',
    defaultCommand: undefined,
    defaultBaseUrl: undefined,
    retiredModelIds: [],
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
    defaultModel: 'claude-sonnet-4-6',
    defaultCommand: undefined,
    defaultBaseUrl: undefined,
    retiredModelIds: [],
    models: [
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
    defaultCommand: undefined,
    defaultBaseUrl: undefined,
    retiredModelIds: [],
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
    defaultCommand: undefined,
    defaultBaseUrl: 'https://api.x.ai/v1',
    retiredModelIds: [],
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
    defaultModel: 'llama3.3',
    defaultCommand: undefined,
    defaultBaseUrl: 'http://localhost:11434',
    retiredModelIds: [],
    models: [
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
  'claude-code': {
    displayName: 'Claude Code (CLI)',
    transport: 'cli',
    requiresApiKey: false,
    // NOTE: 실측(2026-09-09) — 씬 목표 15,000자에서 sonnet 은 목표의 47%, opus 는 92%에 그친다.
    // 기본값이 목표를 못 맞추는 쪽이면 사용자가 원인을 파이프라인에서 찾게 되므로 opus 를 쓴다.
    defaultModel: 'opus',
    defaultCommand: 'claude',
    defaultBaseUrl: undefined,
    retiredModelIds: [],
    models: [
      { id: 'opus', displayName: 'Claude Code · Opus' },
      { id: 'sonnet', displayName: 'Claude Code · Sonnet' },
      { id: 'haiku', displayName: 'Claude Code · Haiku' },
    ],
  },
  codex: {
    displayName: 'Codex (CLI)',
    transport: 'cli',
    requiresApiKey: false,
    defaultModel: 'gpt-5.6-sol',
    defaultCommand: 'codex',
    defaultBaseUrl: undefined,
    retiredModelIds: ['gpt-5-codex'],
    models: [
      { id: 'gpt-5.6-sol', displayName: 'Codex · GPT-5.6 Sol' },
      { id: 'gpt-5.6-terra', displayName: 'Codex · GPT-5.6 Terra' },
      { id: 'gpt-5.6-luna', displayName: 'Codex · GPT-5.6 Luna' },
      { id: 'gpt-5.5', displayName: 'Codex · GPT-5.5' },
      { id: 'gpt-5.4', displayName: 'Codex · GPT-5.4' },
      { id: 'gpt-5.4-mini', displayName: 'Codex · GPT-5.4 mini' },
    ],
  },
  'gemini-cli': {
    displayName: 'Gemini CLI',
    transport: 'cli',
    requiresApiKey: false,
    defaultModel: 'flash',
    defaultCommand: 'gemini',
    defaultBaseUrl: undefined,
    retiredModelIds: [],
    models: [
      { id: 'flash', displayName: 'Gemini CLI · Flash (현행 별칭)' },
      { id: 'pro', displayName: 'Gemini CLI · Pro (현행 별칭)' },
      { id: 'gemini-3.1-pro-preview', displayName: 'Gemini CLI · 3.1 Pro Preview' },
      { id: 'gemini-3-flash-preview', displayName: 'Gemini CLI · 3 Flash Preview' },
      { id: 'gemini-2.5-pro', displayName: 'Gemini CLI · 2.5 Pro' },
      { id: 'gemini-2.5-flash', displayName: 'Gemini CLI · 2.5 Flash' },
    ],
  },
  mock: {
    displayName: 'Mock AI',
    transport: 'mock',
    requiresApiKey: false,
    defaultModel: undefined,
    defaultCommand: undefined,
    defaultBaseUrl: undefined,
    retiredModelIds: [],
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

type ProviderIdsByTransport<T extends ProviderTransport> = {
  [K in AiProviderId]: (typeof providerCatalog)[K]['transport'] extends T ? K : never;
}[AiProviderId];

// 구독 CLI. HTTP 클라이언트 대신 명령을 띄워 부르고, `command`·`model`·`timeoutMs` 설정 모양과
// 사용량 한도 폴백을 공유한다.
export type CliProviderId = ProviderIdsByTransport<'cli'>;

export const aiProviderIds = Object.keys(providerCatalog) as unknown as readonly [
  AiProviderId,
  ...AiProviderId[],
];

export const cliProviderIds = aiProviderIds.filter(
  (providerId) => providerCatalog[providerId].transport === 'cli',
) as unknown as readonly [CliProviderId, ...CliProviderId[]];

// CLI 를 띄우는 두 시간 상한. 프로바이더마다 따로 두면 하나만 고치고 나머지를 놓친다.
export const cliProviderDefaults = {
  generateTimeoutMs: 600_000,
  connectionCheckTimeoutMs: 15_000,
} as const;

// `as const` 는 행마다 실제로 적힌 필드만 남기므로, 선택 필드를 읽는 파생 표는 선언된 모양으로
// 한 번 넓혀서 읽는다.
const catalogRows: Readonly<Record<AiProviderId, ProviderCatalogEntry>> = providerCatalog;

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
      catalogRows[providerId].models
        .filter((model) => model.inputPricePerMillion !== undefined)
        .map((model) => [
          model.id,
          {
            inputPricePerMillion: model.inputPricePerMillion,
            outputPricePerMillion: model.outputPricePerMillion,
          },
        ]),
    ),
  ]),
) as unknown as Readonly<Record<AiProviderId, Readonly<Record<string, ModelPricePerMillion>>>>;

// 구독 CLI 는 요금제로 인증하므로 토큰은 있어도 금액이 없다. 0원으로 더하면 실제 청구액을 낮춰
// 보이게 하면서도 정확한 숫자처럼 보이므로, 금액을 보고하는 쪽은 이것부터 묻는다.
export function isUnpricedProvider(providerId: AiProviderId): boolean {
  return Object.keys(storyboardModelPricing[providerId]).length === 0;
}

export function getProviderDisplayName(providerId: AiProviderId): string {
  return providerCatalog[providerId].displayName;
}

export function getDefaultModelId(providerId: AiProviderId): string | undefined {
  return providerCatalog[providerId].defaultModel;
}

export function getDefaultCliCommand(providerId: CliProviderId): string {
  return providerCatalog[providerId].defaultCommand;
}

export function isRetiredModelId(providerId: AiProviderId, modelId: string): boolean {
  return catalogRows[providerId].retiredModelIds.includes(modelId);
}

export function isModelInCatalogForProvider(providerId: AiProviderId, modelId: string): boolean {
  return catalogRows[providerId].models.some((model) => model.id === modelId);
}
