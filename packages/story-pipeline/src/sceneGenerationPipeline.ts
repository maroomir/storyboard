import type { ProjectFormat, SceneContext } from '@storyboard/story-format';
import type { EntityRef, GenerateTextOptions, StyleDirective } from '@storyboard/story-ai';
import { createEmptyBackground, extractSceneNarrativeSource } from '@storyboard/story-format';
import { condensePreviousContext } from './sceneGenerationPolicies';
import {
  assertNotCancelled,
  buildGenerateOptions,
  buildScenePersonas,
  describeBackgroundForScene,
  withAttribution,
} from './sceneGenerationStages';
import {
  planSectionCount,
  splitSkeletonIntoSections,
  validateExpandedSection,
  SECTION_OUTPUT_LIMIT,
  type SectionViolation,
} from './sceneSectionPlan';
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

const SECTION_RETRY_LIMIT = 2;

interface ResolvedExecutionContext {
  readonly context: SceneContext;
  readonly aiService: SceneGenerationPipelineAiService;
  readonly format: ProjectFormat;
  readonly styleDirective?: StyleDirective;
  readonly providers: Readonly<SceneGenerationPipelineTaskProviders>;
  readonly onProgress?: RunSceneGenerationPipelineInput['onProgress'];
  readonly shouldCancel?: () => boolean;
  readonly narrativeSource: string;
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
  const sceneStem = input.sceneStem ?? input.context.scene.stem;
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
    // 작법 블록을 제외한 서술만 사건 재료로 쓴다. 블록이 섞이면 같은 등장이 두 번 뽑힌다.
    narrativeSource: extractSceneNarrativeSource(body),
    condensedPreviousContext: condensePreviousContext(
      previousContext,
      input.useContextCondense === true,
    ),
    sceneRef: { kind: 'scene', id: sceneStem },
    detectedCharacters,
  };
}

function sectionTargetLength(
  styleDirective: StyleDirective | undefined,
  sectionCount: number,
): number {
  const target = styleDirective?.targetWordCount ?? SECTION_OUTPUT_LIMIT * sectionCount;
  return Math.max(1, Math.round(target / sectionCount));
}

// NOTE: 씬 간 연속성 재료(캐넌·이전 씬)는 사건을 정하는 뼈대 단계에만 넣는다. 살붙임은 뼈대만 보고
// 문장을 다듬으므로, 여기서 설정을 다시 보여 주면 묘사가 새 설정을 끌어들일 여지만 생긴다.
function buildSkeletonContext(
  previousContext: string | undefined,
  canonFactLines: readonly string[] | undefined,
): string | undefined {
  const sections = [
    canonFactLines && canonFactLines.length > 0
      ? `[설정 메모]\n${canonFactLines.map((line) => `- ${line}`).join('\n')}\n(작가 참고용 배경지식이다. 인물이 아직 모르는 사실을 대사·사건으로 드러내지 마라.)`
      : undefined,
    previousContext,
  ].filter((section): section is string => Boolean(section));

  return sections.length > 0 ? sections.join('\n\n') : undefined;
}

async function expandSectionWithRetries(input: {
  readonly aiService: Pick<SceneGenerationPipelineAiService, 'expandSceneSection'>;
  readonly section: string;
  readonly skeleton: string;
  readonly previousSection: string | undefined;
  readonly targetLength: number;
  readonly characters: SceneContext['characters'];
  readonly options: GenerateTextOptions;
}): Promise<{ readonly text: string; readonly violations: readonly SectionViolation[] }> {
  let reasons: string[] = [];
  let lastText = input.section;
  let lastViolations: readonly SectionViolation[] = [];

  for (let attempt = 0; attempt <= SECTION_RETRY_LIMIT; attempt += 1) {
    const expanded = await input.aiService.expandSceneSection(
      {
        skeleton: input.skeleton,
        section: input.section,
        previousSection: input.previousSection,
        targetLength: input.targetLength,
        retryReasons: reasons,
      },
      input.options,
    );

    const violations = validateExpandedSection({
      section: input.section,
      expanded,
      characters: input.characters,
      targetLength: input.targetLength,
    });

    if (violations.length === 0) {
      return { text: expanded, violations: [] };
    }

    lastText = expanded;
    lastViolations = violations;
    reasons = violations.map((violation) => violation.detail);
  }

  // 재시도로도 못 고치면 결과를 채택하되, 위반 내역은 원고 헤더로 올려 읽는 사람이 바로 보게 한다.
  return { text: lastText, violations: lastViolations };
}

async function executeSceneGenerationPipeline(
  input: RunSceneGenerationPipelineInput,
): Promise<RunSceneGenerationPipelineResult> {
  const {
    context,
    aiService,
    styleDirective,
    providers,
    onProgress,
    shouldCancel,
    narrativeSource,
    condensedPreviousContext,
    sceneRef,
    detectedCharacters,
  } = resolveExecutionContext(input);

  const personasUsed = await buildScenePersonas(
    context.characters,
    { ...buildGenerateOptions(providers, 'personaGeneration'), styleDirective },
    aiService,
    input.personaStore,
    sceneRef,
    onProgress,
    shouldCancel,
  );

  const background = context.background
    ? await describeBackgroundForScene(context.background, aiService, input.backgroundStore)
    : createEmptyBackground('scene-default', '미정');
  assertNotCancelled(shouldCancel);

  // 1단계. 사건·등장·종료 지점을 한 문맥에서 확정한다. 이후 단계는 문장만 다듬으므로 연속성이 깨지지 않는다.
  onProgress?.('draftSkeleton', 1, 1);
  const skeleton = await aiService.draftSceneSkeleton(
    {
      narrativeSource,
      personas: personasUsed,
      background,
      previousContext: buildSkeletonContext(condensedPreviousContext, input.canonFactLines),
      endState: context.scene.card?.endState,
      grounding: context.scene.frontmatter.grounding,
    },
    withAttribution(
      { ...buildGenerateOptions(providers, 'sceneSkeleton'), styleDirective },
      { primary: sceneRef },
    ),
  );
  assertNotCancelled(shouldCancel);

  // 2단계. 뼈대를 구간으로 나눠 살을 붙인다. 매 호출이 뼈대 전문과 직전 구간 완성문을 함께 본다.
  const sections = splitSkeletonIntoSections(
    skeleton,
    planSectionCount(styleDirective?.targetWordCount ?? 0),
  );
  const targetLength = sectionTargetLength(styleDirective, sections.length);
  const expandedSections: string[] = [];
  const warnings: string[] = [];

  for (let index = 0; index < sections.length; index += 1) {
    onProgress?.('expandSection', index + 1, sections.length);

    const outcome = await expandSectionWithRetries({
      aiService,
      section: sections[index] as string,
      skeleton,
      previousSection: expandedSections.at(-1),
      targetLength,
      characters: context.characters,
      options: withAttribution(
        { ...buildGenerateOptions(providers, 'sceneSectionExpansion'), styleDirective },
        { primary: sceneRef },
      ),
    });

    expandedSections.push(outcome.text);
    warnings.push(...outcome.violations.map((violation) => `${index + 1}구간: ${violation.detail}`));
    assertNotCancelled(shouldCancel);
  }

  return {
    draftBody: expandedSections.join('\n\n'),
    skeleton,
    warnings,
    detectedCharacters,
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
