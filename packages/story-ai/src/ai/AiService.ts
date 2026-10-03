import type { Background } from '@storyboard/story-format';
import type { Character } from '@storyboard/story-format';
import type { SceneGrounding } from '@storyboard/story-format';
import { coerceChapterPlan, coerceOutlineSynopsis } from '@storyboard/story-format';
import type {
  ChapterPlan,
  OutlineBrief,
  OutlineCharacterBrief,
  OutlineSynopsis,
  ProjectFormat,
} from '@storyboard/story-format';
import { AiTextGateway } from './AiTextGateway';
import {
  CardAiService,
  type ExtractCardCandidatesByCharacterOptions,
  type ExtractFactsByCharacterOptions,
  type ExtractTraitsByCharacterOptions,
} from './CardAiService';
import {
  DraftAiService,
  type ContinuityCheckOptions,
  type DraftExpansionContext,
  type InlineCompletionContext,
} from './DraftAiService';
import { SceneAiService } from './SceneAiService';
import {
  StudioAgentService,
  type StudioAgentRunInput,
  type StudioAgentRunOptions,
  type StudioValidationInput,
} from './StudioAgentService';
import type { StudioCardAuditPromptInput } from './prompts/studioCardAudit';
import type { StudioCardSeed } from '#ai/contracts/studioCardSeed';
import type { GenerateTextOptions, StoryboardAiServiceOptions } from './aiServiceTypes';
import type { AiProviderRegistry } from './providerRegistry';
import type { AiGenerateResponse, AiStreamChunk, AiTaskName } from '#ai/contracts/aiTypes';
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
import {
  type NoteExtraction,
  type NoteExtractionKnownCard,
  type NoteExtractionNote,
} from './prompts/noteExtraction';
import { type NoteSynthesis } from './prompts/noteSynthesis';
import { type PromptArtifact, type PromptConfig } from './prompts/types';
import { parseJsonObject } from '#ai/contracts/aiResponseParser';
import type { StudioAgentAction } from '#ai/contracts/studioAgent';
import type { StudioValidationVerdict } from '#ai/contracts/studioValidation';
import type { DraftCritiqueIssue } from '#ai/contracts/draftReview';
import type { SceneCoverageIssue } from '#ai/contracts/sceneCoverage';
import type { StoryStateUpdateItem } from '#ai/contracts/storyStateUpdate';
import type { StoryStateUpdateInput } from './prompts/storyStateUpdate';
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
  StoryboardAiServiceOptions,
} from './aiServiceTypes';

export type {
  ExtractCardCandidatesByCharacterOptions,
  ExtractFactsByCharacterOptions,
  ExtractTraitsByCharacterOptions,
} from './CardAiService';
export type {
  ContinuityCheckOptions,
  DraftExpansionContext,
  InlineCompletionContext,
} from './DraftAiService';

export class StoryboardAiService {
  private readonly cardAiService: CardAiService;
  private readonly draftAiService: DraftAiService;
  private readonly gateway: AiTextGateway;
  private readonly sceneAiService: SceneAiService;
  private readonly studioAgentService: StudioAgentService;

  public constructor(
    registry: AiProviderRegistry,
    serviceOptions: StoryboardAiServiceOptions = {},
  ) {
    this.gateway = new AiTextGateway(registry, serviceOptions);
    this.cardAiService = new CardAiService(this.gateway);
    this.draftAiService = new DraftAiService(this.gateway);
    this.sceneAiService = new SceneAiService(this.gateway);
    this.studioAgentService = new StudioAgentService(this.gateway);
  }

  public async runStudioAgent(
    input: StudioAgentRunInput,
    options: StudioAgentRunOptions = {},
  ): Promise<StudioAgentAction> {
    return this.studioAgentService.run(input, options);
  }

  public async validateStudioProposal(
    input: StudioValidationInput,
    options: GenerateTextOptions = {},
  ): Promise<StudioValidationVerdict> {
    return this.studioAgentService.validate(input, options);
  }

  public async extractStudioCardSeed(
    description: string,
    options: GenerateTextOptions = {},
  ): Promise<StudioCardSeed | undefined> {
    return this.studioAgentService.seedCard(description, options);
  }

  public async auditStudioEntity(
    input: StudioCardAuditPromptInput,
    options: GenerateTextOptions = {},
  ): Promise<StudioValidationVerdict> {
    return this.studioAgentService.auditEntity(input, options);
  }

  public async extractSituations(
    input: string,
    options: GenerateTextOptions = {},
  ): Promise<SituationWithCharacters[]> {
    return this.sceneAiService.extractSituations(input, options);
  }

  public async proposeSceneGrounding(
    input: Parameters<SceneAiService['proposeSceneGrounding']>[0],
    options: GenerateTextOptions = {},
  ): Promise<SceneGrounding> {
    return this.sceneAiService.proposeSceneGrounding(input, options);
  }

  public async proposeSceneBeats(
    input: Parameters<SceneAiService['proposeSceneBeats']>[0],
    options: GenerateTextOptions = {},
  ): Promise<string[]> {
    return this.sceneAiService.proposeSceneBeats(input, options);
  }

  public async proposeSceneStructure(
    input: Parameters<SceneAiService['proposeSceneStructure']>[0],
    options: GenerateTextOptions = {},
  ): Promise<
    ReturnType<SceneAiService['proposeSceneStructure']> extends Promise<infer T> ? T : never
  > {
    return this.sceneAiService.proposeSceneStructure(input, options);
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
    recentExcerpt?: string,
  ): Promise<string> {
    return this.sceneAiService.describeBackground(background, options, recentExcerpt);
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

  public async draftSceneSkeleton(
    input: Parameters<SceneAiService['draftSceneSkeleton']>[0],
    options: GenerateTextOptions = {},
  ): Promise<string> {
    return this.sceneAiService.draftSceneSkeleton(input, options);
  }

  public async polishSceneDialogue(
    input: Parameters<SceneAiService['polishSceneDialogue']>[0],
    options: GenerateTextOptions = {},
  ): Promise<string> {
    return this.sceneAiService.polishSceneDialogue(input, options);
  }

  public async attributeSceneDialogue(
    input: Parameters<SceneAiService['attributeSceneDialogue']>[0],
    options: GenerateTextOptions = {},
  ): ReturnType<SceneAiService['attributeSceneDialogue']> {
    return this.sceneAiService.attributeSceneDialogue(input, options);
  }

  public async expandSceneSection(
    input: Parameters<SceneAiService['expandSceneSection']>[0],
    options: GenerateTextOptions = {},
  ): Promise<string> {
    return this.sceneAiService.expandSceneSection(input, options);
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

  public async extractNotes(
    notes: readonly NoteExtractionNote[],
    knownCards: readonly NoteExtractionKnownCard[],
    options: GenerateTextOptions = {},
  ): Promise<NoteExtraction> {
    return this.cardAiService.extractNotes(notes, knownCards, options);
  }

  public async synthesizeNotePremise(
    premise: readonly string[],
    castNames: readonly string[],
    options: GenerateTextOptions = {},
  ): Promise<NoteSynthesis> {
    return this.cardAiService.synthesizeNotePremise(premise, castNames, options);
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
    options: ContinuityCheckOptions = {},
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

  public async updateStoryState(
    input: StoryStateUpdateInput,
    options: GenerateTextOptions = {},
  ): Promise<StoryStateUpdateItem[]> {
    return this.draftAiService.updateStoryState(input, options);
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

  public async *generateTextStream(
    taskName: AiTaskName,
    messages: ReadonlyArray<{
      readonly role: 'system' | 'user' | 'assistant';
      readonly content: string;
    }>,
    options: GenerateTextOptions,
  ): AsyncIterable<AiStreamChunk> {
    yield* this.gateway.generateStream(taskName, messages, options);
  }

  public async generateText(
    taskName: AiTaskName,
    messages: ReadonlyArray<{
      readonly role: 'system' | 'user' | 'assistant';
      readonly content: string;
    }>,
    options: GenerateTextOptions = {},
  ): Promise<AiGenerateResponse> {
    return await this.gateway.generate(taskName, messages, options);
  }
}
