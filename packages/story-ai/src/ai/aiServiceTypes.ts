import type { SceneGrounding } from '@storyboard/story-format';
import type { StyleDirective } from '../contracts/styleDirective';
import type { AiProviderId, UsageAttribution, UsageRecord } from '../contracts/aiTypes';

export interface GenerateTextOptions {
  readonly providerId?: AiProviderId;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly attribution?: UsageAttribution;
  readonly styleDirective?: StyleDirective;
  readonly sceneGrounding?: SceneGrounding;
}

export type OnUsageRecordCallback = (record: UsageRecord) => void;

export interface StoryboardAiServiceOptions {
  readonly onUsage?: OnUsageRecordCallback;
}
