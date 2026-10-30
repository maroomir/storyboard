import type { AiProviderId, AiTaskName } from '#model/contracts/ai';

export {
  aiProviderIds,
  aiTaskCatalog,
  aiTaskLabels,
  aiTaskNames,
  isAiProviderId,
  requiresApiKey,
} from '#model/contracts/ai';
export type {
  AiProviderId,
  AiTaskCatalogEntry,
  AiTaskName,
  UsageAmount,
  UsageSummaryByEntity,
} from '#model/contracts/ai';

export type AiMessageRole = 'system' | 'user' | 'assistant';

export type CacheTtl = '5m' | '1h';

export const cacheTtls: readonly [CacheTtl, ...CacheTtl[]] = ['5m', '1h'];

export interface AiMessage {
  readonly role: AiMessageRole;
  readonly content: string;
  readonly cacheBoundary?: boolean;
  readonly cacheTtl?: CacheTtl;
}

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
