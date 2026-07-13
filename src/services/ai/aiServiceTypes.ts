import type { StyleDirective } from '../../shared/styleDirective';
import type { AiProviderId, UsageAttribution, UsageRecord } from '../../shared/aiTypes';

export interface GenerateTextOptions {
  readonly providerId?: AiProviderId;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly attribution?: UsageAttribution;
  readonly styleDirective?: StyleDirective;
}

export type OnUsageRecordCallback = (record: UsageRecord) => void;

export interface StoryboardAIServiceOptions {
  readonly onUsage?: OnUsageRecordCallback;
}
