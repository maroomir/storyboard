import type { Background } from '../../domain/Background';
import type { Character } from '../../domain/Character';
import type { ProjectFormat } from '../../shared/project';
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
import { SituationExtractionPrompt } from './prompts/situationExtraction';
import { parseJsonArray } from '../../shared/aiResponseParser';

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
  ): Promise<string> {
    const variant = this.gateway.resolvePromptVariant('backgroundDescription', options);
    const prompt = BackgroundDescriptionPrompt.build(background, variant);
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
    );
    const response = await this.gateway.generate(
      'personaDialogue',
      toPromptMessages(prompt),
      options,
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
