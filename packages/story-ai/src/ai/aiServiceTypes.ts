import type {
  SceneGrounding,
  StyleDirective,
  AiProviderId,
  UsageAttribution,
  UsageRecord,
} from '@storyboard/story-model';

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
