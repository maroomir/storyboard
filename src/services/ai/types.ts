import type { AiProviderId, AiTaskName } from '../../shared/ai';

export {
  aiProviderIds,
  aiTaskCatalog,
  aiTaskLabels,
  aiTaskNames,
  isAiProviderId,
  isCliProvider,
} from '../../shared/ai';
export type {
  AiProviderId,
  AiTaskCatalogEntry,
  AiTaskName,
  AiTaskStatus,
  UsageSummaryByEntity,
  WiredAiTaskName,
} from '../../shared/ai';

export type AiMessageRole = 'system' | 'user' | 'assistant';

export interface AiMessage {
  readonly role: AiMessageRole;
  readonly content: string;
}

export interface AiGenerateRequest {
  readonly taskName: AiTaskName;
  readonly messages: readonly AiMessage[];
  readonly temperature?: number;
  readonly maxTokens?: number;
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
}

export type EntityKind = 'scene' | 'character' | 'background';

export interface EntityRef {
  readonly kind: EntityKind;
  readonly id: string;
}

export interface UsageAttribution {
  readonly primary?: EntityRef;
  readonly participants?: readonly EntityRef[];
}

export interface AiProviderStatus {
  readonly providerId: AiProviderId;
  readonly displayName: string;
  readonly model?: string;
  readonly hasApiKey: boolean;
  readonly isAvailable: boolean;
}

export type AiConnectionFailureReason = 'not-installed';

export interface AiConnectionResult {
  readonly ok: boolean;
  readonly reason?: AiConnectionFailureReason;
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
  readonly costUsd: number;
  readonly attribution: UsageAttribution;
}
