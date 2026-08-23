import type { ProjectFormat, SceneContext } from '@storyboard/story-format';
import type { EntityRef, GenerateTextOptions, StyleDirective } from '@storyboard/story-ai';
import { createEmptyBackground } from '@storyboard/story-format';
import {
  condensePreviousContext,
  dedupeSituations,
  mergeSituationsToSourceBlockLimit,
} from './sceneGenerationPolicies';
import {
  assertNotCancelled,
  buildGenerateOptions,
  buildScenePersonas,
  describeBackgroundForScene,
  formatSceneDraft,
  generateSceneDialogue,
  withAttribution,
} from './sceneGenerationStages';
import {
  type RunSceneGenerationPipelineInput,
  type RunSceneGenerationPipelineResult,
  type SceneGenerationPipelineAiService,
  type SceneGenerationPipelineTaskProviders,
} from './sceneGenerationTypes';

export type {
  BackgroundMemoryStore,
  PersonaMemoryStore,
  RunSceneGenerationPipelineInput,
  RunSceneGenerationPipelineResult,
  SceneGenerationPipelineAiService,
  SceneGenerationPipelineStage,
  SceneGenerationPipelineTaskProviders,
} from './sceneGenerationTypes';
export { SceneGenerationPipelineCancelledError } from './sceneGenerationTypes';

interface ResolvedExecutionContext {
  readonly context: SceneContext;
  readonly aiService: SceneGenerationPipelineAiService;
  readonly format: ProjectFormat;
  readonly styleDirective?: StyleDirective;
  readonly providers: Readonly<SceneGenerationPipelineTaskProviders>;
  readonly onProgress?: RunSceneGenerationPipelineInput['onProgress'];
  readonly shouldCancel?: () => boolean;
  readonly body: string;
  readonly condensedPreviousContext: string | undefined;
  readonly sceneRef: EntityRef;
  readonly detectedCharacters: string[];
}

function resolveExecutionContext(input: RunSceneGenerationPipelineInput): ResolvedExecutionContext {
  const {
    context,
    aiService,
    format,
    styleDirective,
    previousContext,
    providers = {},
    onProgress,
    shouldCancel,
  } = input;
  const condensedPreviousContext = condensePreviousContext(
    previousContext,
    input.useContextCondense === true,
  );
  const sceneStem = input.sceneStem ?? input.context.scene.stem;
  const sceneRef: EntityRef = { kind: 'scene', id: sceneStem };
  const body = context.scene.body.trim();

  if (body.length === 0) {
    throw new Error(
      '씬 본문이 비어 있습니다. scene 파일에 장면 설명을 작성한 뒤 다시 시도해주세요.',
    );
  }

  const detectedCharacters = context.characters.map((character) => character.name);
  if (detectedCharacters.length === 0) {
    throw new Error(
      '등장인물을 찾을 수 없습니다. 스크립트에 인물 이름을 포함하거나 frontmatter에 characters를 지정해주세요.',
    );
  }

  return {
    context,
    aiService,
    format,
    styleDirective,
    providers,
    onProgress,
    shouldCancel,
    body,
    condensedPreviousContext,
    sceneRef,
    detectedCharacters,
  };
}

async function executeSceneGenerationPipeline(
  input: RunSceneGenerationPipelineInput,
): Promise<RunSceneGenerationPipelineResult> {
  const {
    context,
    aiService,
    format,
    styleDirective,
    providers,
    onProgress,
    shouldCancel,
    body,
    condensedPreviousContext,
    sceneRef,
    detectedCharacters,
  } = resolveExecutionContext(input);

  const situationsRaw = await aiService.extractSituations(
    body,
    withAttribution(buildGenerateOptions(providers, 'situationExtraction'), { primary: sceneRef }),
  );
  onProgress?.('extractSituations', 1, 1);
  assertNotCancelled(shouldCancel);

  const situations = mergeSituationsToSourceBlockLimit(dedupeSituations(situationsRaw), body);
  if (situations.length === 0) {
    throw new Error('상황을 추출할 수 없습니다.');
  }

  const personaOptions: GenerateTextOptions = {
    ...buildGenerateOptions(providers, 'personaGeneration'),
    styleDirective,
  };
  const personasUsed = await buildScenePersonas(
    context.characters,
    personaOptions,
    aiService,
    input.personaStore,
    sceneRef,
    onProgress,
    shouldCancel,
  );

  const backgroundCard = context.background ?? createEmptyBackground('scene-default', '미정');
  const background = context.background
    ? await describeBackgroundForScene(context.background, aiService, input.backgroundStore)
    : backgroundCard;
  const dialogueOptions: GenerateTextOptions = {
    ...buildGenerateOptions(providers, 'personaDialogue'),
    styleDirective,
    sceneGrounding: context.scene.frontmatter.grounding,
  };
  const backgroundParticipantId = context.background?.id ?? input.backgroundId;
  assertNotCancelled(shouldCancel);

  const dialoguePieces = await generateSceneDialogue(
    situations,
    context.characters,
    personasUsed,
    background,
    backgroundParticipantId,
    dialogueOptions,
    condensedPreviousContext,
    aiService,
    sceneRef,
    onProgress,
    shouldCancel,
  );

  const draftBody = await formatSceneDraft(
    dialoguePieces,
    format,
    providers,
    input.sceneBreakJoiner,
    styleDirective,
    aiService,
    sceneRef,
    onProgress,
    shouldCancel,
  );

  return {
    draftBody,
    detectedCharacters,
    situations,
    personasUsed,
    providers,
  };
}

export class SceneGenerationPipeline {
  public constructor(private readonly input: RunSceneGenerationPipelineInput) {}

  public async run(): Promise<RunSceneGenerationPipelineResult> {
    return await executeSceneGenerationPipeline(this.input);
  }
}

export async function runSceneGenerationPipeline(
  input: RunSceneGenerationPipelineInput,
): Promise<RunSceneGenerationPipelineResult> {
  return await new SceneGenerationPipeline(input).run();
}
