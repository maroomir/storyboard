import type { GenerateTextOptions } from './aiServiceTypes';
import { toFactCandidate, toPromptMessages, type FactCandidate } from './aiResponseCoercion';
import { AiTextGateway } from './AiTextGateway';
import {
  BackgroundFactExtractionPrompt,
  coerceBackgroundFactExtraction,
  type BackgroundFactExtraction,
} from './prompts/backgroundFactExtraction';
import {
  CardCandidateExtractionPrompt,
  coerceCardCandidateExtraction,
  type CardCandidateExtraction,
} from './prompts/cardCandidateExtraction';
import { CardCandidateVerificationPrompt } from './prompts/cardCandidateVerification';
import {
  CardRecommendationPrompt,
  coerceCardRecommendations,
  type RecommendationCategory,
  type RecommendedEntity,
} from './prompts/cardRecommendation';
import { FactExtractionPrompt } from './prompts/factExtraction';
import { NoteExtractionPrompt } from './prompts/noteExtraction';
import { NoteSynthesisPrompt } from './prompts/noteSynthesis';
import { coerceNoteSynthesis, type NoteSynthesis } from '@storyboard/story-model';
import { TraitsExtractionPrompt } from './prompts/traitsExtraction';
import type { PromptArtifact, PromptConfig } from './prompts/types';
import type { AiGenerateResponse, UsageAttribution, AiTaskName } from '@storyboard/story-model';
import {
  parseBulletList,
  parseJsonArray,
  parseJsonObject,
  readNoteExtractionResponse,
  type NoteExtractionResult,
  type NoteExtractionKnownCard,
  type NoteExtractionNote,
} from '@storyboard/story-model';

export type ExtractTraitsByCharacterOptions = GenerateTextOptions & {
  readonly aliases?: readonly string[];
  readonly attributionForCharacter?: (characterName: string) => UsageAttribution | undefined;
};

export type ExtractFactsByCharacterOptions = GenerateTextOptions & {
  readonly attributionForCharacter?: (characterName: string) => UsageAttribution | undefined;
};

export type ExtractCardCandidatesByCharacterOptions = GenerateTextOptions & {
  readonly aliases?: readonly string[];
  readonly attributionForCharacter?: (characterName: string) => UsageAttribution | undefined;
};

export class CardAiService {
  public constructor(private readonly gateway: AiTextGateway) {}

  public async extractTraitsByCharacter(
    draftBody: string,
    characterNames: readonly string[],
    options: ExtractTraitsByCharacterOptions = {},
  ): Promise<Record<string, string[]>> {
    return this.extractPerCharacter(
      characterNames,
      options,
      TraitsExtractionPrompt.config,
      async (name, resolvedOptions, attribution) => {
        const variant = this.gateway.resolvePromptVariant('traitsExtraction', resolvedOptions);
        const prompt = TraitsExtractionPrompt.build(draftBody, name, options.aliases, variant);
        const response = await this.gateway.generate('traitsExtraction', toPromptMessages(prompt), {
          ...resolvedOptions,
          attribution,
        });

        return parseBulletList(response.text);
      },
    );
  }

  public async extractFactsByCharacter(
    draftBody: string,
    characterNames: readonly string[],
    options: ExtractFactsByCharacterOptions = {},
  ): Promise<Record<string, FactCandidate[]>> {
    return this.extractPerCharacter(
      characterNames,
      options,
      FactExtractionPrompt.config,
      async (name, resolvedOptions, attribution) => {
        const variant = this.gateway.resolvePromptVariant('factExtraction', resolvedOptions);
        const prompt = FactExtractionPrompt.build(draftBody, name, variant);
        const response = await this.gateway.generate('factExtraction', toPromptMessages(prompt), {
          ...resolvedOptions,
          attribution,
        });
        const parsedArray = parseJsonArray(response.text);

        return parsedArray ? parsedArray.flatMap((value) => toFactCandidate(value)) : [];
      },
    );
  }

  public async extractCardCandidatesByCharacter(
    draftBody: string,
    characterNames: readonly string[],
    options: ExtractCardCandidatesByCharacterOptions = {},
  ): Promise<Record<string, CardCandidateExtraction>> {
    return this.extractPerCharacter(
      characterNames,
      options,
      CardCandidateExtractionPrompt.config,
      async (name, resolvedOptions, attribution) => {
        const variant = this.gateway.resolvePromptVariant('cardFactExtraction', resolvedOptions);
        const prompt = CardCandidateExtractionPrompt.build(
          draftBody,
          name,
          options.aliases,
          variant,
        );
        const response = await this.gateway.generate(
          'cardFactExtraction',
          toPromptMessages(prompt),
          { ...resolvedOptions, attribution },
        );

        return coerceCardCandidateExtraction(parseJsonObject(response.text));
      },
    );
  }

  public async extractBackgroundFactsFromDraft(
    draftBody: string,
    backgroundName: string,
    options: GenerateTextOptions = {},
  ): Promise<BackgroundFactExtraction> {
    const variant = this.gateway.resolvePromptVariant('backgroundFactExtraction', options);
    const prompt = BackgroundFactExtractionPrompt.build(draftBody, backgroundName, variant);
    const response = await this.generateWithDefaults(
      'backgroundFactExtraction',
      prompt,
      BackgroundFactExtractionPrompt.config,
      options,
    );

    return coerceBackgroundFactExtraction(parseJsonObject(response.text));
  }

  public async extractCardRecommendations(
    body: string,
    category: RecommendationCategory,
    knownNames: readonly string[],
    options: GenerateTextOptions = {},
  ): Promise<RecommendedEntity[]> {
    const variant = this.gateway.resolvePromptVariant('cardRecommendation', options);
    const prompt = CardRecommendationPrompt.build(body, category, knownNames, variant);
    const response = await this.generateWithDefaults(
      'cardRecommendation',
      prompt,
      CardRecommendationPrompt.config,
      options,
    );

    return coerceCardRecommendations(parseJsonArray(response.text), category);
  }

  public async extractNotes(
    notes: readonly NoteExtractionNote[],
    knownCards: readonly NoteExtractionKnownCard[],
    options: GenerateTextOptions = {},
  ): Promise<NoteExtractionResult> {
    const variant = this.gateway.resolvePromptVariant('noteExtraction', options);
    const prompt = NoteExtractionPrompt.build(notes, knownCards, variant);
    const response = await this.generateWithDefaults(
      'noteExtraction',
      prompt,
      NoteExtractionPrompt.config,
      options,
    );

    return readNoteExtractionResponse(
      response.text,
      parseJsonObject(response.text),
      response.isTruncated === true,
    );
  }

  public async synthesizeNotePremise(
    premise: readonly string[],
    castNames: readonly string[],
    options: GenerateTextOptions = {},
  ): Promise<NoteSynthesis> {
    const variant = this.gateway.resolvePromptVariant('noteSynthesis', options);
    const prompt = NoteSynthesisPrompt.build(premise, castNames, variant);
    const response = await this.generateWithDefaults(
      'noteSynthesis',
      prompt,
      NoteSynthesisPrompt.config,
      options,
    );

    return coerceNoteSynthesis(parseJsonObject(response.text));
  }

  public async verifyCardCandidatesByCharacter(
    draftBody: string,
    characterName: string,
    statements: readonly string[],
    options: GenerateTextOptions = {},
  ): Promise<number[] | null> {
    if (statements.length === 0) return [];

    const variant = this.gateway.resolvePromptVariant('cardFactVerification', options);
    const prompt = CardCandidateVerificationPrompt.build(
      draftBody,
      characterName,
      statements,
      variant,
    );
    const response = await this.generateWithDefaults(
      'cardFactVerification',
      prompt,
      CardCandidateVerificationPrompt.config,
      options,
    );
    const parsedArray = parseJsonArray(response.text);

    if (!parsedArray) return null;

    const approved = new Set<number>();
    for (const value of parsedArray) {
      const index = typeof value === 'number' ? value : Number(value);
      if (Number.isInteger(index) && index >= 0 && index < statements.length) {
        approved.add(index);
      }
    }

    return [...approved];
  }

  private async extractPerCharacter<T>(
    characterNames: readonly string[],
    options: GenerateTextOptions & {
      readonly attributionForCharacter?: (characterName: string) => UsageAttribution | undefined;
    },
    config: PromptConfig,
    runForName: (
      name: string,
      resolvedOptions: GenerateTextOptions,
      attribution: UsageAttribution | undefined,
    ) => Promise<T>,
  ): Promise<Record<string, T>> {
    const uniqueNames = [
      ...new Set(characterNames.map((name) => name.trim()).filter((name) => name.length > 0)),
    ];
    const resolved = {
      ...options,
      temperature: options.temperature ?? config.temperature,
      maxTokens: options.maxTokens ?? config.maxTokens,
    };
    const entries = await Promise.all(
      uniqueNames.map(async (name) => {
        const attribution = resolved.attributionForCharacter?.(name) ?? resolved.attribution;
        return [name, await runForName(name, resolved, attribution)] as const;
      }),
    );

    return Object.fromEntries(entries);
  }

  private async generateWithDefaults(
    taskName: AiTaskName,
    prompt: PromptArtifact,
    config: PromptConfig,
    options: GenerateTextOptions,
  ): Promise<AiGenerateResponse> {
    return this.gateway.generate(taskName, toPromptMessages(prompt), {
      ...options,
      temperature: options.temperature ?? config.temperature,
      maxTokens: options.maxTokens ?? config.maxTokens,
    });
  }
}
