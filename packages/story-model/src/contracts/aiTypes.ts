import type { AiProviderId, AiTaskName } from './ai';

export {
  aiProviderIds,
  aiTaskCatalog,
  aiTaskLabels,
  aiTaskNames,
  isAiProviderId,
  requiresApiKey,
} from './ai';
export type {
  AiProviderId,
  AiTaskCatalogEntry,
  AiTaskName,
  UsageAmount,
  UsageSummaryByEntity,
} from './ai';

export type AiMessageRole = 'system' | 'user' | 'assistant';

// How long a cached prefix lives after its last use. The hour costs more to write (2× input instead
// of 1.25×) and pays off only for a prefix read ten times or more across a long run.
export type CacheTtl = '5m' | '1h';

export const cacheTtls: readonly [CacheTtl, ...CacheTtl[]] = ['5m', '1h'];

export interface AiMessage {
  readonly role: AiMessageRole;
  readonly content: string;
  // NOTE: 여기까지의 접두를 캐시해도 된다는 표시. 접두 캐싱을 지원하는 프로바이더(Claude)만 읽고
  // 나머지는 무시한다. 같은 접두가 여러 호출에 되풀이될 때만 붙인다.
  readonly cacheBoundary?: boolean;
  // 경계의 캐시 수명. 없으면 프로바이더 기본(5분).
  readonly cacheTtl?: CacheTtl;
}

// How hard a thinking model may think before it answers. Its tokens come out of `maxTokens`.
export type ReasoningEffort = 'low' | 'medium' | 'high';

export const reasoningEfforts: readonly [ReasoningEffort, ...ReasoningEffort[]] = [
  'low',
  'medium',
  'high',
];

export interface AiGenerateRequest {
  readonly taskName: AiTaskName;
  readonly messages: readonly AiMessage[];
  readonly temperature?: number;
  readonly maxTokens?: number;
  // Sent only to a model whose catalog row says it accepts one.
  readonly reasoningEffort?: ReasoningEffort;
}

export type AiStreamChunk =
  | {
      readonly type: 'text-delta';
      readonly delta: string;
    }
  | {
      readonly type: 'done';
      readonly response: AiGenerateResponse;
    };

export interface AiUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens?: number;
  readonly cacheCreationInputTokens?: number;
}

export interface AiGenerateResponse {
  readonly text: string;
  readonly providerId: AiProviderId;
  readonly model?: string;
  readonly usage?: AiUsage;
  readonly costUsd?: number;
  // The provider stopped at the output limit, so the text ends mid-way.
  readonly isTruncated?: boolean;
}

export type EntityKind = 'scene' | 'character' | 'background' | 'project';

export interface EntityRef {
  readonly kind: EntityKind;
  readonly id: string;
}

export interface UsageAttribution {
  readonly primary?: EntityRef;
  readonly participants?: readonly EntityRef[];
}

// A call that serves no one scene or card (the outline, a chapter summary, a manuscript review) is
// still spend on the work, so it is charged to the work as a whole.
export const projectUsageAttribution: UsageAttribution = {
  primary: { kind: 'project', id: 'project' },
};

export interface AiProviderStatus {
  readonly providerId: AiProviderId;
  readonly displayName: string;
  readonly model?: string;
  readonly hasApiKey: boolean;
  readonly isAvailable: boolean;
}

export interface AiConnectionResult {
  readonly ok: boolean;
}

export interface AiProvider {
  readonly id: AiProviderId;
  readonly displayName: string;
  readonly checkConnection: () => Promise<boolean>;
  readonly generate: (request: AiGenerateRequest) => Promise<AiGenerateResponse>;
  readonly generateStream?: (request: AiGenerateRequest) => AsyncIterable<AiStreamChunk>;
}

export interface UsageRecord {
  readonly recordId?: string;
  readonly taskName: AiTaskName;
  readonly providerId: AiProviderId;
  readonly model?: string;
  readonly usage?: AiUsage;
  readonly costUsd?: number;
  readonly attribution: UsageAttribution;
}
