import {
  proseConventionLines,
  voiceStyleLines,
  type StyleDirective,
} from '@storyboard/story-model';
import { renderPrompt } from '#ai/ai/prompts/promptResource';
import { type PromptArtifact, type PromptModule, type PromptVariantId } from '#ai/ai/prompts/types';
import { promptTuning } from '#ai/ai/prompts/promptTuning';

export interface SceneDialoguePolishCharacter {
  readonly name: string;
  readonly persona: string;
  readonly catchphrases?: readonly string[];
  readonly samples?: readonly string[];
  readonly knowledge?: readonly string[];
  readonly speechToOthers?: readonly string[];
  readonly relationChanges?: readonly string[];
}

export interface SceneDialoguePolishInput {
  readonly numberedSkeleton: string;
  readonly character: SceneDialoguePolishCharacter;
  readonly otherCharacters: readonly string[];
  readonly otherVoices?: Readonly<Record<string, string>>;
  readonly retryReasons?: readonly string[];
  readonly style?: StyleDirective;
}

export interface SceneDialogueRewrite {
  readonly index: number;
  readonly text: string;
}

export interface SceneDialoguePolishResult {
  readonly rewrites: readonly SceneDialogueRewrite[];
  readonly isTruncated: boolean;
}

export const SceneDialoguePolishPrompt: PromptModule<[input: SceneDialoguePolishInput, variant?: PromptVariantId]> = {
  config: promptTuning('sceneDialoguePolish'),
  build(input: SceneDialoguePolishInput, variant: PromptVariantId = 'generic'): PromptArtifact {
    const voiceStyle: string[] = voiceStyleLines(input.style);
    const character: SceneDialoguePolishCharacter = input.character;
    const list = (items: readonly string[] | undefined): readonly string[] => items ?? [];

    return renderPrompt('sceneDialoguePolish', variant, {
      view: {
        hasVoiceStyle: voiceStyle.length > 0,
        name: character.name,
        persona: character.persona,
        hasCatchphrases: list(character.catchphrases).length > 0,
        catchphrases: list(character.catchphrases),
        hasSamples: list(character.samples).length > 0,
        samples: list(character.samples),
        hasKnowledge: list(character.knowledge).length > 0,
        knowledge: list(character.knowledge),
        hasSpeechToOthers: list(character.speechToOthers).length > 0,
        speechToOthers: list(character.speechToOthers),
        hasRelationChanges: list(character.relationChanges).length > 0,
        relationChanges: list(character.relationChanges),
        hasOtherCharacters: input.otherCharacters.length > 0,
        hasOtherVoices: input.otherCharacters.some((name) => input.otherVoices?.[name] !== undefined),
        otherCharacters: input.otherCharacters
          .map((name) => {
            const voice: string | undefined = input.otherVoices?.[name];
            return voice === undefined ? `- ${name}` : `- ${name}: ${voice}`;
          })
          .join('\n'),
        numberedSkeleton: input.numberedSkeleton,
        hasRetryReasons: list(input.retryReasons).length > 0,
        retryReasons: list(input.retryReasons).join(' / '),
      },
      partials: {
        proseConventions: proseConventionLines(input.style?.narration?.tense).join('\n'),
        voiceStyle: voiceStyle.join('\n'),
      },
    });
  },
};

export function coerceDialogueRewrites(parsed: readonly unknown[] | null): SceneDialogueRewrite[] {
  if (parsed === null) {
    return [];
  }

  const seen: Set<number> = new Set<number>();
  const rewrites: SceneDialogueRewrite[] = [];

  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }

    const record: Record<string, unknown> = entry as Record<string, unknown>;
    const index: number = typeof record.n === 'number' ? record.n : Number(record.n);
    const text: string = typeof record.text === 'string' ? record.text.trim() : '';

    if (!Number.isInteger(index) || index <= 0 || text.length === 0 || seen.has(index)) {
      continue;
    }

    seen.add(index);
    rewrites.push({ index, text });
  }

  return rewrites;
}
