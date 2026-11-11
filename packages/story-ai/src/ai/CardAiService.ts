import type { GenerateTextOptions } from '#ai/ai/aiServiceTypes';
import { toPromptMessages } from '#ai/ai/aiResponseCoercion';
import { AiTextGateway } from '#ai/ai/AiTextGateway';
import {
  BackgroundFactExtractionPrompt,
  coerceBackgroundFactExtraction,
  type BackgroundFactExtraction,
} from '#ai/ai/prompts/backgroundFactExtraction';
import {
  CardCandidateExtractionPrompt,
  coerceCardCandidateExtraction,
  type CardCandidateExtraction,
} from '#ai/ai/prompts/cardCandidateExtraction';
import {
  CardRecommendationPrompt,
  coerceCardRecommendations,
  type RecommendedEntity,
} from '#ai/ai/prompts/cardRecommendation';
import { NoteCardConsolidationPrompt } from '#ai/ai/prompts/noteCardConsolidation';
import { NoteExtractionPrompt } from '#ai/ai/prompts/noteExtraction';
import { NoteSynthesisPrompt } from '#ai/ai/prompts/noteSynthesis';
import {
  coerceNoteSynthesis,
  readNoteConsolidationResponse,
  type NoteConsolidationResult,
  type NoteConsolidationTarget,
  type NoteSynthesis,
} from '@storyboard/story-model';
import { TraitsExtractionPrompt } from '#ai/ai/prompts/traitsExtraction';
import type { PromptArtifact, PromptConfig, PromptVariantId } from '#ai/ai/prompts/types';
import type {
  AiGenerateResponse,
  UsageAttribution,
  AiTaskName,
  BibleSubjectKind,
} from '@storyboard/story-model';
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
        const variant: PromptVariantId = this.gateway.resolvePromptVariant(
          'traitsExtraction',
          resolvedOptions,
        );
        const prompt: PromptArtifact = TraitsExtractionPrompt.build(
          draftBody,
          name,
          options.aliases,
          variant,
        );
        const response: AiGenerateResponse = await this.gateway.generate(
          'traitsExtraction',
          toPromptMessages(prompt),
          {
            ...resolvedOptions,
            attribution,
          },
        );

        return parseBulletList(response.text);
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
        const variant: PromptVariantId = this.gateway.resolvePromptVariant(
          'cardFactExtraction',
          resolvedOptions,
        );
        const prompt: PromptArtifact = CardCandidateExtractionPrompt.build(
          draftBody,
          name,
          options.aliases,
          variant,
        );
        const response: AiGenerateResponse = await this.gateway.generate(
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
    const variant: PromptVariantId = this.gateway.resolvePromptVariant(
      'backgroundFactExtraction',
      options,
    );
    const prompt: PromptArtifact = BackgroundFactExtractionPrompt.build(
      draftBody,
      backgroundName,
      variant,
    );
    const response: AiGenerateResponse = await this.generateWithDefaults(
      'backgroundFactExtraction',
      prompt,
      BackgroundFactExtractionPrompt.config,
      options,
    );

    return coerceBackgroundFactExtraction(parseJsonObject(response.text));
  }

  public async extractCardRecommendations(
    body: string,
    category: BibleSubjectKind,
    knownNames: readonly string[],
    options: GenerateTextOptions = {},
  ): Promise<RecommendedEntity[]> {
    const variant: PromptVariantId = this.gateway.resolvePromptVariant(
      'cardRecommendation',
      options,
    );
    const prompt: PromptArtifact = CardRecommendationPrompt.build(
      body,
      category,
      knownNames,
      variant,
    );
    const response: AiGenerateResponse = await this.generateWithDefaults(
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
    const variant: PromptVariantId = this.gateway.resolvePromptVariant('noteExtraction', options);
    const prompt: PromptArtifact = NoteExtractionPrompt.build(notes, knownCards, variant);
    const response: AiGenerateResponse = await this.generateWithDefaults(
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
    const variant: PromptVariantId = this.gateway.resolvePromptVariant('noteSynthesis', options);
    const prompt: PromptArtifact = NoteSynthesisPrompt.build(premise, castNames, variant);
    const response: AiGenerateResponse = await this.generateWithDefaults(
      'noteSynthesis',
      prompt,
      NoteSynthesisPrompt.config,
      options,
    );

    return coerceNoteSynthesis(parseJsonObject(response.text));
  }

  public async consolidateNoteCards(
    targets: readonly NoteConsolidationTarget[],
    options: GenerateTextOptions = {},
  ): Promise<NoteConsolidationResult> {
    const variant: PromptVariantId = this.gateway.resolvePromptVariant(
      'noteCardConsolidation',
      options,
    );
    const prompt: PromptArtifact = NoteCardConsolidationPrompt.build(targets, variant);
    const response: AiGenerateResponse = await this.generateWithDefaults(
      'noteCardConsolidation',
      prompt,
      NoteCardConsolidationPrompt.config,
      options,
    );

    return readNoteConsolidationResponse(
      parseJsonObject(response.text),
      response.isTruncated === true,
    );
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
    const uniqueNames: string[] = [
      ...new Set(characterNames.map((name) => name.trim()).filter((name) => name.length > 0)),
    ];
    const resolved: typeof options & PromptConfig = {
      ...options,
      temperature: options.temperature ?? config.temperature,
      maxTokens: options.maxTokens ?? config.maxTokens,
    };
    const entries: (readonly [string, Awaited<T>])[] = await Promise.all(
      uniqueNames.map(async (name) => {
        const attribution: UsageAttribution | undefined =
          resolved.attributionForCharacter?.(name) ?? resolved.attribution;
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
      reasoningEffort: options.reasoningEffort ?? config.reasoningEffort,
    });
  }
}
