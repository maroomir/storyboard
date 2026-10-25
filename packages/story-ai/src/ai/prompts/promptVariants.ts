import { z } from 'zod';

import {
  aiProviderIds,
  aiTaskNames,
  type AiProviderId,
  type AiTaskName,
} from '@storyboard/story-model';

import promptVariantRulesData from './promptVariants.params.json';
import { type PromptVariantId } from './types';

export interface XsVariantRule {
  readonly providers: readonly AiProviderId[];
  readonly modelPattern: string;
  readonly tasks: readonly AiTaskName[];
}

export interface RichVariantRule {
  readonly minimumMaxTokens: number;
  readonly tasks: readonly AiTaskName[];
  readonly modelKeywords: readonly string[];
}

export interface PromptVariantRules {
  readonly xs: XsVariantRule;
  readonly rich: RichVariantRule;
}

export interface PromptVariantRulesOverride {
  readonly xs?: Partial<XsVariantRule>;
  readonly rich?: Partial<RichVariantRule>;
}

const xsRuleShape = {
  providers: z.array(z.enum(aiProviderIds)).readonly(),
  modelPattern: z.string(),
  tasks: z.array(z.enum(aiTaskNames)).readonly(),
} satisfies z.ZodRawShape;

const richRuleShape = {
  minimumMaxTokens: z.number().int().positive(),
  tasks: z.array(z.enum(aiTaskNames)).readonly(),
  modelKeywords: z.array(z.string()).readonly(),
} satisfies z.ZodRawShape;

export const promptVariantRulesSchema: z.ZodType<PromptVariantRules> = z.object({
  xs: z.object(xsRuleShape),
  rich: z.object(richRuleShape),
});

export const promptVariantRulesOverrideSchema: z.ZodType<PromptVariantRulesOverride> =
  z.strictObject({
    xs: z.object(xsRuleShape).partial().optional(),
    rich: z.object(richRuleShape).partial().optional(),
  });

export const defaultPromptVariantRules: PromptVariantRules =
  promptVariantRulesSchema.parse(promptVariantRulesData);

let promptVariantRules: PromptVariantRules = defaultPromptVariantRules;

export function overridePromptVariantRules(override: PromptVariantRulesOverride): void {
  promptVariantRules = {
    xs: { ...promptVariantRules.xs, ...override.xs },
    rich: { ...promptVariantRules.rich, ...override.rich },
  };
}

export function resetPromptVariantRules(): void {
  promptVariantRules = defaultPromptVariantRules;
}

export interface PromptVariantSelectionInput {
  readonly providerId: AiProviderId;
  readonly taskName: AiTaskName;
  readonly model?: string;
  readonly maxTokens?: number;
  readonly override?: PromptVariantId;
}

export function selectPromptVariant(input: PromptVariantSelectionInput): PromptVariantId {
  if (input.override !== undefined) {
    return input.override;
  }

  if (shouldUseXsVariant(input)) {
    return 'xs';
  }

  if (shouldUseRichVariant(input)) {
    return 'rich';
  }

  return 'generic';
}

function shouldUseXsVariant(input: PromptVariantSelectionInput): boolean {
  const rule: XsVariantRule = promptVariantRules.xs;

  if (!rule.providers.includes(input.providerId)) {
    return false;
  }

  const model: string = input.model?.toLowerCase() ?? '';
  const compactModel: boolean = new RegExp(rule.modelPattern).test(model);
  const compactTask: boolean = rule.tasks.includes(input.taskName);

  return compactModel || compactTask;
}

function shouldUseRichVariant(input: PromptVariantSelectionInput): boolean {
  const rule: RichVariantRule = promptVariantRules.rich;

  if (input.maxTokens !== undefined && input.maxTokens >= rule.minimumMaxTokens) {
    return true;
  }

  if (rule.tasks.includes(input.taskName)) {
    return true;
  }

  const model: string = input.model?.toLowerCase() ?? '';
  return rule.modelKeywords.some((keyword) => model.includes(keyword));
}
