import type { Background } from '@/domain/Background';
import type { Character } from '@/domain/Character';
import type { ProjectFormat } from '@/shared/project';
import { AiTextGateway } from './AiTextGateway';
import {
  CardAiService,
  type ExtractCardCandidatesByCharacterOptions,
  type ExtractFactsByCharacterOptions,
  type ExtractTraitsByCharacterOptions,
} from './CardAiService';
import {
  DraftAiService,
  type DraftExpansionContext,
  type InlineCompletionContext,
} from './DraftAiService';
import { SceneAiService } from './SceneAiService';
import type { GenerateTextOptions, StoryboardAIServiceOptions } from './aiServiceTypes';
import type { AiProviderRegistry } from './providerRegistry';
import type { AiGenerateResponse, AiStreamChunk, WiredAiTaskName } from '../../shared/aiTypes';
import { ChapterPlanPrompt } from './prompts/chapterPlan';
import { ChapterSummaryPrompt, type ChapterSummaryInput } from './prompts/chapterSummary';
import type { DraftAugmentInput } from './prompts/draftAugment';
import type { DraftCritiqueInput } from './prompts/draftCritique';
import type { DraftRevisionInput } from './prompts/draftRevision';
import type { DraftCondenseInput } from './prompts/draftCondense';
import { OutlineSynopsisPrompt } from './prompts/outlineSynopsis';
import { type CardCandidateExtraction } from './prompts/cardCandidateExtraction';
import { type BackgroundFactExtraction } from './prompts/backgroundFactExtraction';
import { type RecommendationCategory, type RecommendedEntity } from './prompts/cardRecommendation';
import { type PromptArtifact, type PromptConfig } from './prompts/types';
import { parseJsonObject } from '@/shared/aiResponseParser';
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
} from './aiServiceTypes';

export type {
  ExtractCardCandidatesByCharacterOptions,
  ExtractFactsByCharacterOptions,
  ExtractTraitsByCharacterOptions,
} from './CardAiService';
export type { DraftExpansionContext, InlineCompletionContext } from './DraftAiService';

export class StoryboardAIService {
  private readonly cardAiService: CardAiService;
  private readonly draftAiService: DraftAiService;
  private readonly gateway: AiTextGateway;
  private readonly sceneAiService: SceneAiService;

  public constructor(
    registry: AiProviderRegistry,
    serviceOptions: StoryboardAIServiceOptions = {},
  ) {
    this.gateway = new AiTextGateway(registry, serviceOptions);
    this.cardAiService = new CardAiService(this.gateway);
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

  public async extractTraitsByCharacter(
    draftBody: string,
    characterNames: readonly string[],
    options: ExtractTraitsByCharacterOptions = {},
  ): Promise<Record<string, string[]>> {
    return this.cardAiService.extractTraitsByCharacter(draftBody, characterNames, options);
  }

  public async extractFactsByCharacter(
    draftBody: string,
    characterNames: readonly string[],
    options: ExtractFactsByCharacterOptions = {},
  ): Promise<Record<string, FactCandidate[]>> {
    return this.cardAiService.extractFactsByCharacter(draftBody, characterNames, options);
  }

  public async extractCardCandidatesByCharacter(
    draftBody: string,
    characterNames: readonly string[],
    options: ExtractCardCandidatesByCharacterOptions = {},
  ): Promise<Record<string, CardCandidateExtraction>> {
    return this.cardAiService.extractCardCandidatesByCharacter(draftBody, characterNames, options);
  }

  public async extractBackgroundFactsFromDraft(
    draftBody: string,
    backgroundName: string,
    options: GenerateTextOptions = {},
  ): Promise<BackgroundFactExtraction> {
    return this.cardAiService.extractBackgroundFactsFromDraft(draftBody, backgroundName, options);
  }

  public async extractCardRecommendations(
    body: string,
    category: RecommendationCategory,
    knownNames: readonly string[],
    options: GenerateTextOptions = {},
  ): Promise<RecommendedEntity[]> {
    return this.cardAiService.extractCardRecommendations(body, category, knownNames, options);
  }

  public async verifyCardCandidatesByCharacter(
    draftBody: string,
    characterName: string,
    statements: readonly string[],
    options: GenerateTextOptions = {},
  ): Promise<number[] | null> {
    return this.cardAiService.verifyCardCandidatesByCharacter(
      draftBody,
      characterName,
      statements,
      options,
    );
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

  public async condenseDraft(
    input: DraftCondenseInput,
    options: GenerateTextOptions = {},
  ): Promise<string> {
    return this.draftAiService.condenseDraft(input, options);
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

  public async generateText(
    taskName: WiredAiTaskName,
    messages: ReadonlyArray<{
      readonly role: 'system' | 'user' | 'assistant';
      readonly content: string;
    }>,
    options: GenerateTextOptions = {},
  ): Promise<AiGenerateResponse> {
    return await this.gateway.generate(taskName, messages, options);
  }
}
