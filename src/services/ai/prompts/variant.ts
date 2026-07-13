import { type AiProviderId, type AiTaskName } from '@/shared/aiTypes';

import { type PromptVariantId } from './types';

export interface PromptVariantSelectionInput {
  readonly providerId: AiProviderId;
  readonly taskName: AiTaskName;
  readonly model?: string;
  readonly maxTokens?: number;
}

export function selectPromptVariant(input: PromptVariantSelectionInput): PromptVariantId {
  if (shouldUseXsVariant(input)) {
    return 'xs';
  }

  if (shouldUseRichVariant(input)) {
    return 'rich';
  }

  return 'generic';
}

function shouldUseXsVariant(input: PromptVariantSelectionInput): boolean {
  if (input.providerId !== 'ollama') {
    return false;
  }

  const model = input.model?.toLowerCase() ?? '';
  const compactModel = /qwen|phi|gemma|mistral|tiny|mini|small|1b|2b|3b|7b/.test(model);
  const compactTask = input.taskName === 'inlineCompletion' || input.taskName === 'grammarCheck';

  return compactModel || compactTask;
}

function shouldUseRichVariant(input: PromptVariantSelectionInput): boolean {
  if (input.maxTokens !== undefined && input.maxTokens >= 4000) {
    return true;
  }

  if (
    input.taskName === 'personaDialogue' ||
    input.taskName === 'sceneDraft' ||
    input.taskName === 'draftExpansion'
  ) {
    return true;
  }

  const model = input.model?.toLowerCase() ?? '';
  return (
    model.includes('opus') ||
    model.includes('sonnet') ||
    model.includes('gpt-5') ||
    model.includes('gpt-4.1') ||
    model.includes('gemini-2.5-pro')
  );
}
