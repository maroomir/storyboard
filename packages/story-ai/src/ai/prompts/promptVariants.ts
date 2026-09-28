import { z } from 'zod';

import {
  aiProviderIds,
  aiTaskNames,
  type AiProviderId,
  type AiTaskName,
} from '#ai/contracts/aiTypes';

import promptVariantRulesData from './promptVariants.params.json';
import { type PromptVariantId } from './types';

// Which prompt variant a call gets when the setting does not force one. The compact `xs` text goes
// to small local models and to tasks that a small model handles anyway; the `rich` text goes to a
// long output, a long-form task or a top-tier model. The rules are data (promptVariants.params.json)
// so a new model family is a list entry, and an author's promptVariants.json lays over them.
const xsRuleSchema = z.object({
  providers: z.array(z.enum(aiProviderIds)).readonly(),
  // A model name matching this pattern counts as compact.
  modelPattern: z.string(),
  tasks: z.array(z.enum(aiTaskNames)).readonly(),
});

const richRuleSchema = z.object({
  minimumMaxTokens: z.number().int().positive(),
  tasks: z.array(z.enum(aiTaskNames)).readonly(),
  // A model name containing one of these counts as top tier.
  modelKeywords: z.array(z.string()).readonly(),
});

export const promptVariantRulesSchema = z.object({ xs: xsRuleSchema, rich: richRuleSchema });

export type PromptVariantRules = z.infer<typeof promptVariantRulesSchema>;

export const promptVariantRulesOverrideSchema = z.object({
  xs: xsRuleSchema.partial().optional(),
  rich: richRuleSchema.partial().optional(),
});

export type PromptVariantRulesOverride = z.infer<typeof promptVariantRulesOverrideSchema>;

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
  // 설정이 강제한 변형. 있으면 모델 이름 규칙보다 앞선다.
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
  const rule = promptVariantRules.xs;

  if (!rule.providers.includes(input.providerId)) {
    return false;
  }

  const model = input.model?.toLowerCase() ?? '';
  const compactModel = new RegExp(rule.modelPattern).test(model);
  const compactTask = rule.tasks.includes(input.taskName);

  return compactModel || compactTask;
}

function shouldUseRichVariant(input: PromptVariantSelectionInput): boolean {
  const rule = promptVariantRules.rich;

  if (input.maxTokens !== undefined && input.maxTokens >= rule.minimumMaxTokens) {
    return true;
  }

  if (rule.tasks.includes(input.taskName)) {
    return true;
  }

  const model = input.model?.toLowerCase() ?? '';
  return rule.modelKeywords.some((keyword) => model.includes(keyword));
}
