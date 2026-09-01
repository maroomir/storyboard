import type { Background } from '@storyboard/story-format';
import type { Character } from '@storyboard/story-format';
import type { ProjectFormat } from '@storyboard/story-format';
import type { GenerateTextOptions } from './aiServiceTypes';
import {
  toPromptMessages,
  toSituationWithCharacters,
  type SituationWithCharacters,
} from './aiResponseCoercion';
import { AiTextGateway } from './AiTextGateway';
import { BackgroundDescriptionPrompt } from './prompts/backgroundDescription';
import { GenreFormattingPrompt } from './prompts/genreFormatting';
import { PersonaDialoguePrompt } from './prompts/personaDialogue';
import { PersonaGenerationPrompt } from './prompts/personaGeneration';
import { SceneGroundingPrompt } from './prompts/sceneGrounding';
import { SceneSkeletonPrompt, type SceneSkeletonInput } from './prompts/sceneSkeleton';
import {
  SceneDialogueAttributionPrompt,
  type SceneDialogueAttributionInput,
} from './prompts/sceneDialogueAttribution';
import {
  SceneDialoguePolishPrompt,
  type SceneDialoguePolishInput,
} from './prompts/sceneDialoguePolish';
import {
  coerceDialogueAttribution,
  type DialogueAttribution,
} from '../contracts/sceneDialogueAttribution';
import {
  SceneSectionExpansionPrompt,
  type SceneSectionExpansionInput,
} from './prompts/sceneSectionExpansion';
import { SceneStructurePrompt, type SceneStructureFieldKey } from './prompts/sceneStructure';
import { SituationExtractionPrompt } from './prompts/situationExtraction';
import { parseJsonArray, parseJsonObject } from '../contracts/aiResponseParser';
import {
  sceneGroundingFieldKeys,
  sceneGroundingFieldLabels,
  type SceneGrounding,
  type SceneGroundingFieldKey,
} from '@storyboard/story-format';

export class SceneAiService {
  public constructor(private readonly gateway: AiTextGateway) {}

  public async extractSituations(
    input: string,
    options: GenerateTextOptions = {},
  ): Promise<SituationWithCharacters[]> {
    const variant = this.gateway.resolvePromptVariant('situationExtraction', options);
    const prompt = SituationExtractionPrompt.build(input, variant);
    const response = await this.gateway.generate(
      'situationExtraction',
      toPromptMessages(prompt),
      options,
    );
    const parsedArray = parseJsonArray(response.text);

    return parsedArray ? parsedArray.flatMap((item) => toSituationWithCharacters(item)) : [];
  }

  // 빈 grounding 필드만 채워 달라고 요청한다. 이미 확정된 사실은 모순 방지용 컨텍스트로만 넘긴다.
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

    const variant = this.gateway.resolvePromptVariant('sceneGrounding', options);
    const prompt = SceneGroundingPrompt.build(
      {
        sceneBody: input.sceneBody,
        missingFields: input.missingFields,
        characterNames: input.characterNames,
        knownGrounding: describeKnownGrounding(input.knownGrounding),
      },
      variant,
    );
    const response = await this.gateway.generate('sceneGrounding', toPromptMessages(prompt), {
      ...options,
      temperature: options.temperature ?? SceneGroundingPrompt.config.temperature,
      maxTokens: options.maxTokens ?? SceneGroundingPrompt.config.maxTokens,
    });

    return toSceneGrounding(parseJsonObject(response.text), input.missingFields);
  }

  // summary(자유 산문)에서 비어 있는 구조 필드만 제안받는다. 이미 작성된 필드는 모순 방지용
  // 컨텍스트로만 넘긴다.
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

    const variant = this.gateway.resolvePromptVariant('sceneStructure', options);
    const prompt = SceneStructurePrompt.build(
      {
        sceneSummary: input.sceneSummary,
        missingFields: input.missingFields,
        knownFields: input.knownFields,
      },
      variant,
    );
    const response = await this.gateway.generate('sceneStructure', toPromptMessages(prompt), {
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
    const variant = this.gateway.resolvePromptVariant('personaGeneration', options);
    const prompt = PersonaGenerationPrompt.build(character, variant, options.styleDirective);
    const response = await this.gateway.generate(
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
    const variant = this.gateway.resolvePromptVariant('backgroundDescription', options);
    const prompt = BackgroundDescriptionPrompt.build(background, variant, recentExcerpt);
    const response = await this.gateway.generate(
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

  public async generatePersonaDialogue(
    situation: string,
    personas: ReadonlyMap<string, string>,
    background: Background,
    previousContext?: string,
    options: GenerateTextOptions = {},
  ): Promise<string> {
    const variant = this.gateway.resolvePromptVariant('personaDialogue', options);
    const prompt = PersonaDialoguePrompt.build(
      situation,
      personas,
      background,
      previousContext,
      variant,
      options.styleDirective,
      options.sceneGrounding,
    );
    const response = await this.gateway.generate(
      'personaDialogue',
      toPromptMessages(prompt),
      options,
    );

    return response.text.trim();
  }

  public async draftSceneSkeleton(
    input: SceneSkeletonInput,
    options: GenerateTextOptions = {},
  ): Promise<string> {
    const variant = this.gateway.resolvePromptVariant('sceneSkeleton', options);
    const prompt = SceneSkeletonPrompt.build({ ...input, style: options.styleDirective }, variant);
    const response = await this.gateway.generate('sceneSkeleton', toPromptMessages(prompt), {
      ...options,
      temperature: options.temperature ?? SceneSkeletonPrompt.config.temperature,
      maxTokens: options.maxTokens ?? SceneSkeletonPrompt.config.maxTokens,
    });

    return response.text.trim();
  }

  public async polishSceneDialogue(
    input: SceneDialoguePolishInput,
    options: GenerateTextOptions = {},
  ): Promise<string> {
    const variant = this.gateway.resolvePromptVariant('sceneDialoguePolish', options);
    const prompt = SceneDialoguePolishPrompt.build(
      { ...input, style: options.styleDirective },
      variant,
    );
    const response = await this.gateway.generate('sceneDialoguePolish', toPromptMessages(prompt), {
      ...options,
      temperature: options.temperature ?? SceneDialoguePolishPrompt.config.temperature,
      maxTokens: options.maxTokens ?? SceneDialoguePolishPrompt.config.maxTokens,
    });

    return response.text.trim();
  }

  public async attributeSceneDialogue(
    input: SceneDialogueAttributionInput,
    options: GenerateTextOptions = {},
  ): Promise<DialogueAttribution[]> {
    const variant = this.gateway.resolvePromptVariant('sceneDialogueAttribution', options);
    const prompt = SceneDialogueAttributionPrompt.build(input, variant);
    const response = await this.gateway.generate(
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
    const variant = this.gateway.resolvePromptVariant('sceneSectionExpansion', options);
    const prompt = SceneSectionExpansionPrompt.build(
      { ...input, style: options.styleDirective },
      variant,
    );
    const response = await this.gateway.generate(
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
    const variant = this.gateway.resolvePromptVariant('sceneDraft', options);
    const prompt = GenreFormattingPrompt.build(dialogue, format, variant, options.styleDirective);
    const response = await this.gateway.generate('sceneDraft', toPromptMessages(prompt), options);

    return response.text.trim();
  }
}

function describeKnownGrounding(grounding: SceneGrounding | undefined): string[] {
  if (!grounding) {
    return [];
  }

  return sceneGroundingFieldKeys.flatMap((key) => {
    const value = grounding[key]?.trim();
    return value ? [`- ${sceneGroundingFieldLabels[key]}: ${value}`] : [];
  });
}

export interface SceneStructureProposal {
  readonly purpose?: string;
  readonly conflict?: string;
  readonly twist?: string;
  readonly emotionalShift?: string;
  readonly foreshadowing?: string[];
  readonly neededCanon?: string[];
}

const sceneStructureListKeys: readonly SceneStructureFieldKey[] = ['foreshadowing', 'neededCanon'];

function toSceneStructureProposal(
  parsed: Record<string, unknown> | null,
  requestedFields: readonly SceneStructureFieldKey[],
): SceneStructureProposal {
  if (!parsed) {
    return {};
  }

  const proposal: Record<string, string | string[]> = {};

  for (const key of requestedFields) {
    const value = parsed[key];

    if (sceneStructureListKeys.includes(key)) {
      if (Array.isArray(value)) {
        const items = value
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
    const value = parsed[key];

    if (typeof value === 'string' && value.trim().length > 0) {
      grounding[key] = value.trim();
    }
  }

  return grounding;
}
