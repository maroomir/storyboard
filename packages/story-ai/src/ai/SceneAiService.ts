import type {
  AiGenerateResponse,
  Background,
  Character,
  ProjectFormat,
  SceneStructureFieldKey,
SceneStructureProposal,
} from '@storyboard/story-model';
import type { GenerateTextOptions } from './aiServiceTypes';
import {
  toPromptMessages,
  toSituationWithCharacters,
  type SituationWithCharacters,
} from './aiResponseCoercion';
import { AiTextGateway } from './AiTextGateway';
import { BackgroundDescriptionPrompt } from './prompts/backgroundDescription';
import { BackgroundFactConflictsPrompt } from './prompts/backgroundFactConflicts';
import { GenreFormattingPrompt } from './prompts/genreFormatting';
import { PersonaGenerationPrompt } from './prompts/personaGeneration';
import { SceneBeatsPrompt } from './prompts/sceneBeats';
import { SceneGroundingPrompt } from './prompts/sceneGrounding';
import { SceneSkeletonPrompt, type SceneSkeletonInput } from './prompts/sceneSkeleton';
import {
  coerceBeatProposal,
  SceneBeatActorPrompt,
  type SceneBeatActorInput,
  type SceneBeatProposal,
} from './prompts/sceneBeatActor';
import {
  SceneBeatArbiterPrompt,
  splitBeatPassage,
  type SceneBeatArbiterInput,
  type SceneBeatPassage,
} from './prompts/sceneBeatArbiter';
import { parseBeatJsonObject } from './prompts/sceneBeatBlocks';
import {
  coerceBeatVerdict,
  SceneBeatJudgePrompt,
  type SceneBeatJudgeInput,
  type SceneBeatVerdict,
} from './prompts/sceneBeatJudge';
import {
  SceneDialogueAttributionPrompt,
  type SceneDialogueAttributionInput,
} from './prompts/sceneDialogueAttribution';
import {
  coerceDialogueRewrites,
  SceneDialoguePolishPrompt,
  type SceneDialoguePolishInput,
  type SceneDialoguePolishResult,
} from './prompts/sceneDialoguePolish';
import {
  coerceDialogueAttribution,
  type DialogueAttribution,
  listBackgroundFactLines,
  parseJsonArray,
  coerceExpandedSceneBeats,
  type ExpandedSceneBeat,
  parseJsonObject,
  readBackgroundFactConflictResponse,
  type BackgroundFactConflict,
  sceneGroundingLines,
  sceneGroundingFieldKeys,
  sceneGroundingFieldLabels,
  type SceneGrounding,
  type SceneGroundingFieldKey,
isSceneStructureListField,
} from '@storyboard/story-model';
import {
  SceneSectionExpansionPrompt,
  type SceneSectionExpansionInput,
} from './prompts/sceneSectionExpansion';
import { SceneStructurePrompt } from './prompts/sceneStructure';
import { SituationExtractionPrompt } from './prompts/situationExtraction';
import type { PromptArtifact, PromptVariantId } from '#ai/ai/prompts/types';

export class SceneAiService {
  public constructor(private readonly gateway: AiTextGateway) {}

  public async extractSituations(
    input: string,
    options: GenerateTextOptions = {},
  ): Promise<SituationWithCharacters[]> {
    const variant: PromptVariantId = this.gateway.resolvePromptVariant('situationExtraction', options);
    const prompt: PromptArtifact = SituationExtractionPrompt.build(input, variant);
    const response: AiGenerateResponse = await this.gateway.generate(
      'situationExtraction',
      toPromptMessages(prompt),
      options,
    );
    const parsedArray: unknown[] | null = parseJsonArray(response.text);

    return parsedArray ? parsedArray.flatMap((item) => toSituationWithCharacters(item)) : [];
  }

  public async proposeSceneGrounding(
    input: {
      readonly sceneBody: string;
      readonly missingFields: readonly SceneGroundingFieldKey[];
      readonly characterNames: readonly string[];
      readonly knownGrounding?: SceneGrounding;
    },
    options: GenerateTextOptions = {},
  ): Promise<SceneGrounding> {
    if (input.missingFields.length === 0) {
      return {};
    }

    const variant: PromptVariantId = this.gateway.resolvePromptVariant('sceneGrounding', options);
    const prompt: PromptArtifact = SceneGroundingPrompt.build(
      {
        sceneBody: input.sceneBody,
        missingFields: input.missingFields,
        characterNames: input.characterNames,
        knownGrounding: describeKnownGrounding(input.knownGrounding),
      },
      variant,
    );
    const response: AiGenerateResponse = await this.gateway.generate('sceneGrounding', toPromptMessages(prompt), {
      ...options,
      temperature: options.temperature ?? SceneGroundingPrompt.config.temperature,
      maxTokens: options.maxTokens ?? SceneGroundingPrompt.config.maxTokens,
    });

    return toSceneGrounding(parseJsonObject(response.text), input.missingFields);
  }

  public async proposeSceneBeats(
    input: {
      readonly sceneBody: string;
      readonly summary?: string;
      readonly grounding?: SceneGrounding;
      readonly characterNames: readonly string[];
      readonly beatCount: number;
    },
    options: GenerateTextOptions = {},
  ): Promise<ExpandedSceneBeat[]> {
    const variant: PromptVariantId = this.gateway.resolvePromptVariant('sceneBeats', options);
    const prompt: PromptArtifact = SceneBeatsPrompt.build(
      {
        sceneBody: input.sceneBody,
        ...(input.summary === undefined ? {} : { summary: input.summary }),
        grounding: sceneGroundingLines(input.grounding),
        characterNames: input.characterNames,
        beatCount: input.beatCount,
      },
      variant,
    );
    const response: AiGenerateResponse = await this.gateway.generate('sceneBeats', toPromptMessages(prompt), {
      ...options,
      temperature: options.temperature ?? SceneBeatsPrompt.config.temperature,
      maxTokens: options.maxTokens ?? SceneBeatsPrompt.config.maxTokens,
    });

    return coerceExpandedSceneBeats(response.text);
  }

  public async proposeSceneStructure(
    input: {
      readonly sceneSummary: string;
      readonly missingFields: readonly SceneStructureFieldKey[];
      readonly knownFields: readonly string[];
    },
    options: GenerateTextOptions = {},
  ): Promise<SceneStructureProposal> {
    if (input.missingFields.length === 0 || input.sceneSummary.trim().length === 0) {
      return {};
    }

    const variant: PromptVariantId = this.gateway.resolvePromptVariant('sceneStructure', options);
    const prompt: PromptArtifact = SceneStructurePrompt.build(
      {
        sceneSummary: input.sceneSummary,
        missingFields: input.missingFields,
        knownFields: input.knownFields,
      },
      variant,
    );
    const response: AiGenerateResponse = await this.gateway.generate('sceneStructure', toPromptMessages(prompt), {
      ...options,
      temperature: options.temperature ?? SceneStructurePrompt.config.temperature,
      maxTokens: options.maxTokens ?? SceneStructurePrompt.config.maxTokens,
    });

    return toSceneStructureProposal(parseJsonObject(response.text), input.missingFields);
  }

  public async createCharacterPersona(
    character: Character,
    options: GenerateTextOptions = {},
  ): Promise<string> {
    const variant: PromptVariantId = this.gateway.resolvePromptVariant('personaGeneration', options);
    const prompt: PromptArtifact = PersonaGenerationPrompt.build(character, variant, options.styleDirective);
    const response: AiGenerateResponse = await this.gateway.generate(
      'personaGeneration',
      toPromptMessages(prompt),
      options,
    );

    return response.text.trim();
  }

  public async describeBackground(
    background: Background,
    options: GenerateTextOptions = {},
    recentExcerpt?: string,
  ): Promise<string> {
    const variant: PromptVariantId = this.gateway.resolvePromptVariant('backgroundDescription', options);
    const prompt: PromptArtifact = BackgroundDescriptionPrompt.build(background, variant, recentExcerpt);
    const response: AiGenerateResponse = await this.gateway.generate(
      'backgroundDescription',
      toPromptMessages(prompt),
      {
        ...options,
        temperature: options.temperature ?? BackgroundDescriptionPrompt.config.temperature,
        maxTokens: options.maxTokens ?? BackgroundDescriptionPrompt.config.maxTokens,
      },
    );

    return response.text.trim();
  }

  public async findBackgroundFactConflicts(
    background: Background,
    options: GenerateTextOptions = {},
  ): Promise<BackgroundFactConflict[]> {
    const variant: PromptVariantId = this.gateway.resolvePromptVariant('backgroundFactConflicts', options);
    const prompt: PromptArtifact = BackgroundFactConflictsPrompt.build(background, variant);
    const response: AiGenerateResponse = await this.gateway.generate(
      'backgroundFactConflicts',
      toPromptMessages(prompt),
      {
        ...options,
        temperature: options.temperature ?? BackgroundFactConflictsPrompt.config.temperature,
        maxTokens: options.maxTokens ?? BackgroundFactConflictsPrompt.config.maxTokens,
      },
    );

    return readBackgroundFactConflictResponse(
      parseJsonObject(response.text),
      listBackgroundFactLines(background),
    );
  }

  public async draftSceneSkeleton(
    input: SceneSkeletonInput,
    options: GenerateTextOptions = {},
  ): Promise<string> {
    const variant: PromptVariantId = this.gateway.resolvePromptVariant('sceneSkeleton', options);
    const prompt: PromptArtifact = SceneSkeletonPrompt.build({ ...input, style: options.styleDirective }, variant);
    const response: AiGenerateResponse = await this.gateway.generate('sceneSkeleton', toPromptMessages(prompt), {
      ...options,
      temperature: options.temperature ?? SceneSkeletonPrompt.config.temperature,
      maxTokens: options.maxTokens ?? SceneSkeletonPrompt.config.maxTokens,
    });

    return response.text.trim();
  }

  public async polishSceneDialogue(
    input: SceneDialoguePolishInput,
    options: GenerateTextOptions = {},
  ): Promise<SceneDialoguePolishResult> {
    const variant: PromptVariantId = this.gateway.resolvePromptVariant('sceneDialoguePolish', options);
    const prompt: PromptArtifact = SceneDialoguePolishPrompt.build(
      { ...input, style: options.styleDirective },
      variant,
    );
    const response: AiGenerateResponse = await this.gateway.generate('sceneDialoguePolish', toPromptMessages(prompt), {
      ...options,
      temperature: options.temperature ?? SceneDialoguePolishPrompt.config.temperature,
      maxTokens: options.maxTokens ?? SceneDialoguePolishPrompt.config.maxTokens,
    });

    return {
      rewrites: coerceDialogueRewrites(parseJsonArray(response.text)),
      isTruncated: response.isTruncated === true,
    };
  }

  public async proposeBeatAction(
    input: SceneBeatActorInput,
    options: GenerateTextOptions = {},
  ): Promise<SceneBeatProposal | undefined> {
    const variant: PromptVariantId = this.gateway.resolvePromptVariant('sceneBeatActor', options);
    const prompt: PromptArtifact = SceneBeatActorPrompt.build(input, variant);
    const response: AiGenerateResponse = await this.gateway.generate('sceneBeatActor', toPromptMessages(prompt), {
      ...options,
      temperature: options.temperature ?? SceneBeatActorPrompt.config.temperature,
      maxTokens: options.maxTokens ?? SceneBeatActorPrompt.config.maxTokens,
    });

    return coerceBeatProposal(parseBeatJsonObject(response.text));
  }

  public async arbitrateBeat(
    input: SceneBeatArbiterInput,
    options: GenerateTextOptions = {},
  ): Promise<SceneBeatPassage> {
    const variant: PromptVariantId = this.gateway.resolvePromptVariant('sceneBeatArbiter', options);
    const prompt: PromptArtifact = SceneBeatArbiterPrompt.build({ ...input, style: options.styleDirective }, variant);
    const response: AiGenerateResponse = await this.gateway.generate('sceneBeatArbiter', toPromptMessages(prompt), {
      ...options,
      temperature: options.temperature ?? SceneBeatArbiterPrompt.config.temperature,
      maxTokens: options.maxTokens ?? SceneBeatArbiterPrompt.config.maxTokens,
    });

    return splitBeatPassage(response.text);
  }

  public async judgeBeat(
    input: SceneBeatJudgeInput,
    options: GenerateTextOptions = {},
  ): Promise<SceneBeatVerdict | undefined> {
    const variant: PromptVariantId = this.gateway.resolvePromptVariant('sceneBeatJudge', options);
    const prompt: PromptArtifact = SceneBeatJudgePrompt.build(input, variant);
    const response: AiGenerateResponse = await this.gateway.generate('sceneBeatJudge', toPromptMessages(prompt), {
      ...options,
      temperature: options.temperature ?? SceneBeatJudgePrompt.config.temperature,
      maxTokens: options.maxTokens ?? SceneBeatJudgePrompt.config.maxTokens,
    });

    return coerceBeatVerdict(parseBeatJsonObject(response.text));
  }

  public async attributeSceneDialogue(
    input: SceneDialogueAttributionInput,
    options: GenerateTextOptions = {},
  ): Promise<DialogueAttribution[]> {
    const variant: PromptVariantId = this.gateway.resolvePromptVariant('sceneDialogueAttribution', options);
    const prompt: PromptArtifact = SceneDialogueAttributionPrompt.build(input, variant);
    const response: AiGenerateResponse = await this.gateway.generate(
      'sceneDialogueAttribution',
      toPromptMessages(prompt),
      {
        ...options,
        temperature: options.temperature ?? SceneDialogueAttributionPrompt.config.temperature,
        maxTokens: options.maxTokens ?? SceneDialogueAttributionPrompt.config.maxTokens,
      },
    );

    return coerceDialogueAttribution(
      response.text,
      input.lines.length,
      input.candidates.map((candidate) => candidate.id),
    );
  }

  public async expandSceneSection(
    input: SceneSectionExpansionInput,
    options: GenerateTextOptions = {},
  ): Promise<string> {
    const variant: PromptVariantId = this.gateway.resolvePromptVariant('sceneSectionExpansion', options);
    const prompt: PromptArtifact = SceneSectionExpansionPrompt.build(
      { ...input, style: options.styleDirective },
      variant,
    );
    const response: AiGenerateResponse = await this.gateway.generate(
      'sceneSectionExpansion',
      toPromptMessages(prompt),
      {
        ...options,
        temperature: options.temperature ?? SceneSectionExpansionPrompt.config.temperature,
        maxTokens: options.maxTokens ?? SceneSectionExpansionPrompt.config.maxTokens,
      },
    );

    return response.text.trim();
  }

  public async applyGenreFormat(
    dialogue: string,
    format: ProjectFormat,
    options: GenerateTextOptions = {},
  ): Promise<string> {
    const variant: PromptVariantId = this.gateway.resolvePromptVariant('sceneDraft', options);
    const prompt: PromptArtifact = GenreFormattingPrompt.build(dialogue, format, variant, options.styleDirective);
    const response: AiGenerateResponse = await this.gateway.generate('sceneDraft', toPromptMessages(prompt), options);

    return response.text.trim();
  }
}

function describeKnownGrounding(grounding: SceneGrounding | undefined): string[] {
  if (!grounding) {
    return [];
  }

  return sceneGroundingFieldKeys.flatMap((key) => {
    const value: string | undefined = grounding[key]?.trim();
    return value ? [`- ${sceneGroundingFieldLabels[key]}: ${value}`] : [];
  });
}

function toSceneStructureProposal(
  parsed: Record<string, unknown> | null,
  requestedFields: readonly SceneStructureFieldKey[],
): SceneStructureProposal {
  if (!parsed) {
    return {};
  }

  const proposal: Record<string, string | string[]> = {};

  for (const key of requestedFields) {
    const value: unknown = parsed[key];

    if (isSceneStructureListField(key)) {
      if (Array.isArray(value)) {
        const items: string[] = value
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter((item) => item.length > 0);

        if (items.length > 0) {
          proposal[key] = items;
        }
      }
      continue;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      proposal[key] = value.trim();
    }
  }

  return proposal;
}

function toSceneGrounding(
  parsed: Record<string, unknown> | null,
  requestedFields: readonly SceneGroundingFieldKey[],
): SceneGrounding {
  if (!parsed) {
    return {};
  }

  const grounding: Record<string, string> = {};

  for (const key of requestedFields) {
    const value: unknown = parsed[key];

    if (typeof value === 'string' && value.trim().length > 0) {
      grounding[key] = value.trim();
    }
  }

  return grounding;
}
