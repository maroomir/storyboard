import type { Background } from '@/domain/Background';
import type { Character } from '@/domain/Character';
import type { ProjectFormat } from '@/shared/project';
import { AiTextGateway } from './AiTextGateway';
import {
  DraftAiService,
  type DraftExpansionContext,
  type InlineCompletionContext,
} from './DraftAiService';
import { SceneAiService } from './SceneAiService';
import type { GenerateTextOptions, StoryboardAIServiceOptions } from './ai-service-types';
import type { AiProviderRegistry } from './providerRegistry';
import type { AiGenerateResponse, AiStreamChunk, UsageAttribution, WiredAiTaskName } from './types';
import { ChapterPlanPrompt } from './prompts/chapterPlan';
import { ChapterSummaryPrompt, type ChapterSummaryInput } from './prompts/chapterSummary';
import type { DraftAugmentInput } from './prompts/draftAugment';
import type { DraftCritiqueInput } from './prompts/draftCritique';
import type { DraftRevisionInput } from './prompts/draftRevision';
import { OutlineSynopsisPrompt } from './prompts/outlineSynopsis';
import { FactExtractionPrompt } from './prompts/factExtraction';
import {
  CardCandidateExtractionPrompt,
  coerceCardCandidateExtraction,
  type CardCandidateExtraction,
} from './prompts/cardCandidateExtraction';
import { CardCandidateVerificationPrompt } from './prompts/cardCandidateVerification';
import {
  BackgroundFactExtractionPrompt,
  coerceBackgroundFactExtraction,
  type BackgroundFactExtraction,
} from './prompts/backgroundFactExtraction';
import {
  CardRecommendationPrompt,
  coerceCardRecommendations,
  type RecommendationCategory,
  type RecommendedEntity,
} from './prompts/cardRecommendation';
import { TraitsExtractionPrompt } from './prompts/traitsExtraction';
import { type PromptArtifact, type PromptConfig } from './prompts/types';
import { parseBulletList, parseJsonArray, parseJsonObject } from '@/utils/aiResponseParser';
import {
  coerceChapterPlan,
  coerceOutlineSynopsis,
  type ChapterPlan,
  type OutlineBrief,
  type OutlineCharacterBrief,
  type OutlineSynopsis,
} from '@/shared/outline';
import type { DraftCritiqueIssue } from '@/shared/draftReview';
import type { SceneCoverageIssue } from '@/shared/sceneCoverage';
import {
  toFactCandidate,
  toPromptMessages,
  type ContinuityIssue,
  type FactCandidate,
  type GrammarIssue,
  type SituationWithCharacters,
} from './aiResponseCoercion';

export type {
  ContinuityIssue,
  FactCandidate,
  GrammarIssue,
  SituationWithCharacters,
} from './aiResponseCoercion';
export type {
  GenerateTextOptions,
  OnUsageRecordCallback,
  StoryboardAIServiceOptions,
} from './ai-service-types';

export interface ExtractTraitsByCharacterOptions extends GenerateTextOptions {
  readonly attributionForCharacter?: (characterName: string) => UsageAttribution | undefined;
  readonly aliases?: readonly string[];
}

export interface ExtractFactsByCharacterOptions extends GenerateTextOptions {
  readonly attributionForCharacter?: (characterName: string) => UsageAttribution | undefined;
}

export interface ExtractCardCandidatesByCharacterOptions extends GenerateTextOptions {
  readonly attributionForCharacter?: (characterName: string) => UsageAttribution | undefined;
  readonly aliases?: readonly string[];
}

export type { DraftExpansionContext, InlineCompletionContext } from './DraftAiService';

export class StoryboardAIService {
  private readonly draftAiService: DraftAiService;
  private readonly gateway: AiTextGateway;
  private readonly sceneAiService: SceneAiService;

  public constructor(
    registry: AiProviderRegistry,
    serviceOptions: StoryboardAIServiceOptions = {},
  ) {
    this.gateway = new AiTextGateway(registry, serviceOptions);
    this.draftAiService = new DraftAiService(this.gateway);
    this.sceneAiService = new SceneAiService(this.gateway);
  }

  public async extractSituations(
    input: string,
    options: GenerateTextOptions = {},
  ): Promise<SituationWithCharacters[]> {
    return this.sceneAiService.extractSituations(input, options);
  }

  public async createCharacterPersona(
    character: Character,
    options: GenerateTextOptions = {},
  ): Promise<string> {
    return this.sceneAiService.createCharacterPersona(character, options);
  }

  public async describeBackground(
    background: Background,
    options: GenerateTextOptions = {},
  ): Promise<string> {
    return this.sceneAiService.describeBackground(background, options);
  }

  public async generatePersonaDialogue(
    situation: string,
    personas: ReadonlyMap<string, string>,
    background: Background,
    previousContext?: string,
    options: GenerateTextOptions = {},
  ): Promise<string> {
    return this.sceneAiService.generatePersonaDialogue(
      situation,
      personas,
      background,
      previousContext,
      options,
    );
  }

  public async applyGenreFormat(
    dialogue: string,
    format: ProjectFormat,
    options: GenerateTextOptions = {},
  ): Promise<string> {
    return this.sceneAiService.applyGenreFormat(dialogue, format, options);
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
          {
            ...resolvedOptions,
            attribution,
          },
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

  public async verifyCardCandidatesByCharacter(
    draftBody: string,
    characterName: string,
    statements: readonly string[],
    options: GenerateTextOptions = {},
  ): Promise<number[] | null> {
    if (statements.length === 0) {
      return [];
    }

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

    if (!parsedArray) {
      return null;
    }

    const approved = new Set<number>();

    for (const value of parsedArray) {
      const index = typeof value === 'number' ? value : Number(value);
      if (Number.isInteger(index) && index >= 0 && index < statements.length) {
        approved.add(index);
      }
    }

    return [...approved];
  }

  public async checkGrammar(
    body: string,
    options: GenerateTextOptions = {},
  ): Promise<GrammarIssue[]> {
    return this.draftAiService.checkGrammar(body, options);
  }

  public async checkContinuity(
    body: string,
    facts: readonly string[],
    options: GenerateTextOptions = {},
  ): Promise<ContinuityIssue[]> {
    return this.draftAiService.checkContinuity(body, facts, options);
  }

  public async checkSceneCoverage(
    beats: readonly string[],
    draft: string,
    options: GenerateTextOptions = {},
  ): Promise<SceneCoverageIssue[]> {
    return this.draftAiService.checkSceneCoverage(beats, draft, options);
  }

  public async completeInline(
    prefix: string,
    context: InlineCompletionContext = {},
    options: GenerateTextOptions = {},
  ): Promise<string> {
    return this.draftAiService.completeInline(prefix, context, options);
  }

  public async expandDraft(
    selection: string,
    context: DraftExpansionContext = {},
    options: GenerateTextOptions = {},
  ): Promise<string> {
    return this.draftAiService.expandDraft(selection, context, options);
  }

  public async generateOutlineSynopsis(
    brief: OutlineBrief,
    options: GenerateTextOptions = {},
  ): Promise<OutlineSynopsis> {
    const variant = this.gateway.resolvePromptVariant('outlineSynopsis', options);
    const prompt = OutlineSynopsisPrompt.build(brief, variant);
    const response = await this.generateWithDefaults(
      'outlineSynopsis',
      prompt,
      OutlineSynopsisPrompt.config,
      options,
    );

    return coerceOutlineSynopsis(parseJsonObject(response.text), brief);
  }

  public async generateChapterPlan(
    brief: OutlineBrief,
    synopsis: OutlineSynopsis,
    characters: readonly OutlineCharacterBrief[],
    options: GenerateTextOptions = {},
  ): Promise<ChapterPlan> {
    const variant = this.gateway.resolvePromptVariant('chapterPlan', options);
    const prompt = ChapterPlanPrompt.build(brief, synopsis, characters, variant);
    const response = await this.generateWithDefaults(
      'chapterPlan',
      prompt,
      ChapterPlanPrompt.config,
      options,
    );

    return coerceChapterPlan(parseJsonObject(response.text));
  }

  public async critiqueDraft(
    input: DraftCritiqueInput,
    options: GenerateTextOptions = {},
  ): Promise<DraftCritiqueIssue[]> {
    return this.draftAiService.critiqueDraft(input, options);
  }

  public async summarizeChapter(
    input: ChapterSummaryInput,
    options: GenerateTextOptions = {},
  ): Promise<string> {
    const variant = this.gateway.resolvePromptVariant('chapterSummary', options);
    const prompt = ChapterSummaryPrompt.build(input, variant);
    const response = await this.generateWithDefaults(
      'chapterSummary',
      prompt,
      ChapterSummaryPrompt.config,
      options,
    );

    return response.text.trim();
  }

  public async reviseDraft(
    input: DraftRevisionInput,
    options: GenerateTextOptions = {},
  ): Promise<string> {
    return this.draftAiService.reviseDraft(input, options);
  }

  public async augmentDraft(
    input: DraftAugmentInput,
    options: GenerateTextOptions = {},
  ): Promise<string> {
    return this.draftAiService.augmentDraft(input, options);
  }

  private async generateWithDefaults(
    taskName: WiredAiTaskName,
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

  public async *generateTextStream(
    taskName: WiredAiTaskName,
    messages: ReadonlyArray<{
      readonly role: 'system' | 'user' | 'assistant';
      readonly content: string;
    }>,
    options: GenerateTextOptions,
  ): AsyncIterable<AiStreamChunk> {
    yield* this.gateway.generateStream(taskName, messages, options);
  }
}
