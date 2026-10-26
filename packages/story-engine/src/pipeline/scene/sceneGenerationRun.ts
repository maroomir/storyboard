import {
  planSceneBreaks,
  renderPlannedNarrative,
  type SceneBreakPlan,
} from '#engine/pipeline/sceneBreakPlan';
import type { SceneCoordinateLedger } from '#engine/pipeline/sceneCoordinates';
import { condensePreviousContext } from '#engine/pipeline/sceneGenerationPolicies';
import {
  resolveSceneGenerationTuning,
  type ResolvedSceneGenerationTuning,
} from '#engine/pipeline/sceneGenerationTuning';
import type {
  DialoguePolishSummary,
  RunSceneGenerationPipelineInput,
  SceneGenerationPipelineAiService,
  SceneGenerationPipelineTaskProviders,
} from '#engine/pipeline/sceneGenerationTypes';
import {
  createEmptyBackground,
  renderSceneCardBody,
  splitSceneNarrativeSource,
  type Background,
  type BackgroundFactConflict,
  type EntityRef,
  type ProjectFormat,
  type SceneBeat,
  type SceneCard,
  type SceneContext,
  type SceneDialogueRecord,
  type SceneNarrativeParts,
  type StyleDirective,
} from '@storyboard/story-model';

export class SceneGenerationRun {
  public readonly context: SceneContext;
  public readonly aiService: SceneGenerationPipelineAiService;
  public readonly format: ProjectFormat;
  public readonly styleDirective?: StyleDirective;
  public readonly providers: Readonly<SceneGenerationPipelineTaskProviders>;
  public readonly onProgress?: RunSceneGenerationPipelineInput['onProgress'];
  public readonly shouldCancel?: () => boolean;
  public readonly narrativeSource: string;
  public readonly design: string;
  public readonly breakPlan: SceneBreakPlan | undefined;
  public readonly tuning: ResolvedSceneGenerationTuning;
  public readonly condensedPreviousContext: string | undefined;
  public readonly sceneRef: EntityRef;
  public readonly detectedCharacters: string[];
  public personasUsed: Map<string, string>;
  public background: Background;
  public backgroundFactConflicts: readonly BackgroundFactConflict[];
  public voiceSamples: Map<string, readonly string[]>;
  public skeleton: string;
  public sceneCoordinates: SceneCoordinateLedger;
  public polishedText: string;
  public dialoguePolish: DialoguePolishSummary | undefined;
  public readonly warnings: string[];
  public draftBody: string;
  public dialogueRecord: SceneDialogueRecord | undefined;

  private constructor(
    public readonly input: RunSceneGenerationPipelineInput,
    resolved: ResolvedExecutionContext,
  ) {
    this.context = resolved.context;
    this.aiService = resolved.aiService;
    this.format = resolved.format;
    this.styleDirective = resolved.styleDirective;
    this.providers = resolved.providers;
    this.onProgress = resolved.onProgress;
    this.shouldCancel = resolved.shouldCancel;
    this.narrativeSource = resolved.narrativeSource;
    this.design = resolved.design;
    this.breakPlan = resolved.breakPlan;
    this.tuning = resolved.tuning;
    this.condensedPreviousContext = resolved.condensedPreviousContext;
    this.sceneRef = resolved.sceneRef;
    this.detectedCharacters = resolved.detectedCharacters;
    this.personasUsed = new Map();
    this.background = createEmptyBackground('scene-default', '미정');
    this.backgroundFactConflicts = [];
    this.voiceSamples = new Map();
    this.skeleton = '';
    this.sceneCoordinates = { segments: [], isAlignedWithBreaks: true };
    this.polishedText = '';
    this.dialoguePolish = undefined;
    this.warnings = [];
    this.draftBody = '';
    this.dialogueRecord = undefined;
  }

  public static create(input: RunSceneGenerationPipelineInput): SceneGenerationRun {
    return new SceneGenerationRun(input, resolveExecutionContext(input));
  }
}

interface ResolvedExecutionContext {
  readonly context: SceneContext;
  readonly aiService: SceneGenerationPipelineAiService;
  readonly format: ProjectFormat;
  readonly styleDirective?: StyleDirective;
  readonly providers: Readonly<SceneGenerationPipelineTaskProviders>;
  readonly onProgress?: RunSceneGenerationPipelineInput['onProgress'];
  readonly shouldCancel?: () => boolean;
  readonly narrativeSource: string;
  readonly design: string;
  readonly breakPlan: SceneBreakPlan | undefined;
  readonly tuning: ResolvedSceneGenerationTuning;
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
  const sceneStem: string = input.sceneStem ?? input.context.scene.stem;
  const body: string = context.scene.body.trim();
  const narrativeParts: SceneNarrativeParts = splitSceneNarrativeSource(
    renderNarrativeBodyWithCastNames(context) ?? body,
  );
  const tuning: ResolvedSceneGenerationTuning = resolveSceneGenerationTuning(input.tuning);
  const beats: SceneBeat[] = context.scene.card?.beats ?? [];
  const breakPlan: SceneBreakPlan | undefined = planSceneBreaks(
    beats,
    castNameOf(context),
    tuning.sceneBreakTimeJumpMinutes,
  );

  if (body.length === 0) {
    throw new Error(
      '씬 본문이 비어 있습니다. scene 파일에 장면 설명을 작성한 뒤 다시 시도해주세요.',
    );
  }

  const detectedCharacters: string[] = context.characters.map((character) => character.name);
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
    narrativeSource:
      breakPlan === undefined
        ? narrativeParts.narrative
        : renderPlannedNarrative(beats, breakPlan, castNameOf(context)),
    design: narrativeParts.design,
    breakPlan,
    tuning,
    condensedPreviousContext: condensePreviousContext(
      previousContext,
      input.useContextCondense === true,
      tuning.contextCondensedMaxChars,
    ),
    sceneRef: { kind: 'scene', id: sceneStem },
    detectedCharacters,
  };
}

export function castNameOf(context: SceneContext): (ref: string) => string {
  const nameById: Map<string, string> = new Map(
    context.characters.map((character) => [character.id, character.name]),
  );
  return (ref) => nameById.get(ref) ?? ref;
}

function renderNarrativeBodyWithCastNames(context: SceneContext): string | undefined {
  const card: SceneCard = context.scene.card;
  const hasCoordinates: boolean = (card?.beats ?? []).some((beat) => typeof beat !== 'string');
  if (card === undefined || !hasCoordinates) {
    return undefined;
  }

  return renderSceneCardBody(card, context.scene.summaryText, castNameOf(context));
}
