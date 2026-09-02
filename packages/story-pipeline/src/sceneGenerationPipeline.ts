import type {
  CharacterCard,
  ProjectFormat,
  SceneContext,
  SceneDialogueRecord,
} from '@storyboard/story-format';
import type { EntityRef, GenerateTextOptions, StyleDirective } from '@storyboard/story-ai';
import {
  computeDraftBodyHash,
  createEmptyBackground,
  extractSceneNarrativeSource,
  unknownDialogueSpeaker,
} from '@storyboard/story-format';
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
  planSectionTargetLengths,
  quotedDialoguePattern,
  splitSkeletonIntoSections,
  validateExpandedSection,
  validatePolishedSkeleton,
  validateSceneSkeleton,
  findRepeatedDialogueRun,
  SECTION_OUTPUT_LIMIT,
  type SectionViolation,
} from './sceneSectionPlan';
import { selectRepresentativeDialogue } from './dialogueCorpus';
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

// NOTE: 뼈대가 얇으면 살붙임이 감당 못 할 배율(15배)을 요구받아 분량이 미달한다. 최종 목표의
// 1/3을 뼈대에 배분해 확장이 3배 남짓이 되게 한다.
const SKELETON_LENGTH_RATIO = 1 / 3;

function skeletonTargetLength(styleDirective: StyleDirective | undefined): number | undefined {
  const target = styleDirective?.targetWordCount;
  return target === undefined ? undefined : Math.round(target * SKELETON_LENGTH_RATIO);
}

function sectionTargetLengths(
  styleDirective: StyleDirective | undefined,
  sections: readonly string[],
): number[] {
  const target = styleDirective?.targetWordCount ?? SECTION_OUTPUT_LIMIT * sections.length;
  return planSectionTargetLengths(sections, target);
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

// 뼈대는 씬에서 가장 비싼 호출이라 한 번만 다시 부른다. 두 판 다 되풀이하면 덜 되풀이한 쪽을
// 남긴다 — 사건이 빠진 판보다는 겹친 판이 고치기 쉽다.
const SKELETON_RETRY_LIMIT = 1;

async function draftSkeletonWithRetries(
  aiService: Pick<SceneGenerationPipelineAiService, 'draftSceneSkeleton'>,
  input: Parameters<SceneGenerationPipelineAiService['draftSceneSkeleton']>[0],
  options: GenerateTextOptions,
): Promise<string> {
  let best: { text: string; run: number } | undefined;

  for (let attempt = 0; attempt <= SKELETON_RETRY_LIMIT; attempt += 1) {
    const reasons = best === undefined ? [] : validateSceneSkeleton(best.text).map((v) => v.detail);
    const skeleton = await aiService.draftSceneSkeleton(
      { ...input, ...(reasons.length > 0 ? { retryReasons: reasons } : {}) },
      options,
    );
    const violations = validateSceneSkeleton(skeleton);

    if (violations.length === 0) {
      return skeleton;
    }

    const run = findRepeatedDialogueRun(skeleton);
    if (best === undefined || run < best.run) {
      best = { text: skeleton, run };
    }
  }

  return best?.text ?? '';
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
  let best: {
    text: string;
    violations: readonly SectionViolation[];
    weight: number;
    distance: number;
  } = {
    text: input.section,
    violations: [],
    weight: Number.POSITIVE_INFINITY,
    distance: Number.POSITIVE_INFINITY,
  };

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
      skeleton: input.skeleton,
      section: input.section,
      expanded,
      characters: input.characters,
      targetLength: input.targetLength,
      ...(input.previousSection === undefined ? {} : { previousSection: input.previousSection }),
    });

    if (violations.length === 0) {
      return { text: expanded, violations: [] };
    }

    // 같은 무게라면 목표 분량에 가까운 판이 낫다. 재시도는 대개 분량을 더 쓰라는 지시를 받고 도는데,
    // 무조건 첫 판을 남기면 그 개선분을 버리게 된다.
    const weight = weighViolations(violations);
    const distance = Math.abs(expanded.length - input.targetLength);
    if (weight < best.weight || (weight === best.weight && distance < best.distance)) {
      best = { text: expanded, violations, weight, distance };
    }

    reasons = violations.map((violation) => violation.detail);
  }

  // 재시도로도 못 고치면 가장 가벼운 판을 채택하되, 위반 내역은 원고 헤더로 올려 바로 보게 한다.
  return { text: best.text, violations: best.violations };
}

// NOTE: 마지막 판이 가장 나은 판이라는 보장이 없다. 새 인물이나 문자 오염은 원고를 못 쓰게 만들고
// 분량 미달은 읽는 데 지장이 없으므로, 같은 개수라도 가벼운 쪽을 남긴다.
const violationWeights: Readonly<Record<SectionViolation['kind'], number>> = {
  cast: 3,
  'foreign-script': 3,
  'dialogue-count': 2,
  'lost-dialogue': 2,
  // 앞 구간을 다시 쓴 판은 원고를 못 쓰게 만든다. 분량 미달보다 무겁게 센다.
  'repeats-previous': 3,
  'too-long': 1,
  'too-short': 1,
};

function weighViolations(violations: readonly SectionViolation[]): number {
  return violations.reduce((total, violation) => total + violationWeights[violation.kind], 0);
}

// NOTE: 다듬기가 사건을 늘리면 씬 전체가 오염되므로, 위반이 남으면 다듬기 이전 뼈대로 되돌린다.
// 대사 개성은 덜해도 사건은 안전하고, 되돌린 사실은 헤더 경고로 알린다.
const POLISH_LENGTH_LIMIT_RATIO = 2;

async function polishDialogueOrKeepSkeleton(input: {
  readonly aiService: Pick<SceneGenerationPipelineAiService, 'polishSceneDialogue'>;
  readonly skeleton: string;
  readonly personas: ReadonlyMap<string, string>;
  readonly voiceSamples: ReadonlyMap<string, readonly string[]>;
  readonly characters: SceneContext['characters'];
  readonly options: GenerateTextOptions;
}): Promise<{ readonly text: string; readonly warnings: readonly string[] }> {
  let lastViolations: readonly SectionViolation[] = [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const polished = await input.aiService.polishSceneDialogue(
      { skeleton: input.skeleton, personas: input.personas, voiceSamples: input.voiceSamples },
      input.options,
    );

    const violations = validatePolishedSkeleton({
      skeleton: input.skeleton,
      polished,
      characters: input.characters,
      lengthLimit: input.skeleton.length * POLISH_LENGTH_LIMIT_RATIO,
    });

    if (violations.length === 0) {
      return { text: polished, warnings: [] };
    }

    lastViolations = violations;
  }

  return {
    text: input.skeleton,
    warnings: lastViolations.map((violation) => `대사 다듬기를 되돌렸습니다 — ${violation.detail}`),
  };
}

function extractDialogueLines(text: string): string[] {
  return [...text.matchAll(quotedDialoguePattern)].map((match) => (match[1] ?? '').trim());
}

// NOTE: 페르소나 맵은 인물 이름으로 묶여 있고 사이드카는 카드 id로 묶여 있다. 다듬기 프롬프트가
// 이름 블록을 쓰므로 여기서 이름 기준으로 옮겨 담는다.
async function buildVoiceSamples(
  characters: readonly CharacterCard[],
  dialogueCorpus: RunSceneGenerationPipelineInput['dialogueCorpus'],
  sceneStem: string | undefined,
): Promise<Map<string, readonly string[]>> {
  const voiceSamples = new Map<string, readonly string[]>();

  if (!dialogueCorpus) {
    return voiceSamples;
  }

  const corpus = await dialogueCorpus.loadCorpus();

  for (const character of characters) {
    const samples = selectRepresentativeDialogue(corpus, character.id, sceneStem ?? '');
    if (samples.length > 0) {
      voiceSamples.set(character.name, samples);
    }
  }

  return voiceSamples;
}

// NOTE: 귀속은 말투 코퍼스를 위한 메타데이터라서 실패해도 생성을 멈추지 않는다. 화자를 못 정하면
// unknown으로 남긴다. 대상은 뼈대가 아니라 디스크에 나가는 초안 본문이다 — 살붙임이 대사를 새로
// 만들기도 하므로, 뼈대를 기준으로 삼으면 원고에 실린 대사의 일부가 기록에서 빠진다.
// 저장하지 않고 결과로 돌려주기만 한다. 파생물이 원본보다 먼저 디스크에 닿으면, 살붙임이 실패한
// 뒤에도 존재하지 않는 초안을 기술하는 기록이 남는다.
async function buildDialogueRecord(input: {
  readonly aiService: SceneGenerationPipelineAiService;
  readonly draftBody: string;
  readonly characters: readonly CharacterCard[];
  readonly sceneStem: string | undefined;
  readonly options: GenerateTextOptions;
  readonly onProgress: RunSceneGenerationPipelineInput['onProgress'];
}): Promise<SceneDialogueRecord | undefined> {
  const { sceneStem } = input;

  if (!sceneStem) {
    return undefined;
  }

  const lines = extractDialogueLines(input.draftBody);
  const candidates = input.characters.map((character) => ({
    id: character.id,
    name: character.name,
  }));

  if (lines.length === 0) {
    return undefined;
  }

  input.onProgress?.('attributeDialogue', 1, 1);

  let speakers: readonly { readonly index: number; readonly speaker: string }[] = [];
  if (candidates.length > 0) {
    try {
      speakers = await input.aiService.attributeSceneDialogue(
        { skeleton: input.draftBody, lines, candidates },
        input.options,
      );
    } catch {
      speakers = [];
    }
  }

  const speakerByIndex = new Map(speakers.map((entry) => [entry.index, entry.speaker]));
  return {
    sceneStem,
    bodyHash: computeDraftBodyHash(input.draftBody),
    turns: lines.map((text, offset) => ({
      index: offset + 1,
      speaker: speakerByIndex.get(offset + 1) ?? unknownDialogueSpeaker,
      text,
    })),
  };
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
    ? await describeBackgroundForScene(
        context.background,
        aiService,
        input.backgroundStore,
        input.backgroundRecentExcerpt,
      )
    : createEmptyBackground('scene-default', '미정');
  assertNotCancelled(shouldCancel);

  const voiceSamples = await buildVoiceSamples(
    context.characters,
    input.dialogueCorpus,
    input.sceneStem,
  );

  // 1단계. 사건·등장·종료 지점을 한 문맥에서 확정한다. 이후 단계는 문장만 다듬으므로 연속성이 깨지지 않는다.
  onProgress?.('draftSkeleton', 1, 1);
  const skeleton = await draftSkeletonWithRetries(
    aiService,
    {
      narrativeSource,
      personas: personasUsed,
      background,
      previousContext: buildSkeletonContext(condensedPreviousContext, input.canonFactLines),
      endState: context.scene.card?.endState,
      grounding: context.scene.frontmatter.grounding,
      targetLength: skeletonTargetLength(styleDirective),
    },
    withAttribution(
      { ...buildGenerateOptions(providers, 'sceneSkeleton'), styleDirective },
      { primary: sceneRef },
    ),
  );
  assertNotCancelled(shouldCancel);

  // 2단계. 대사의 말투만 손본다. 턴을 늘리지는 않는다. 대화 밀도는 뼈대가 정한 대로 간다.
  onProgress?.('polishDialogue', 1, 1);
  const polished = await polishDialogueOrKeepSkeleton({
    aiService,
    skeleton,
    personas: personasUsed,
    voiceSamples,
    characters: context.characters,
    options: withAttribution(
      { ...buildGenerateOptions(providers, 'sceneDialoguePolish'), styleDirective },
      { primary: sceneRef },
    ),
  });
  assertNotCancelled(shouldCancel);

  // 3단계. 뼈대를 구간으로 나눠 살을 붙인다. 매 호출이 뼈대 전문과 직전 구간 완성문을 함께 본다.
  const sections = splitSkeletonIntoSections(
    polished.text,
    planSectionCount(styleDirective?.targetWordCount ?? 0),
  );
  const targetLengths = sectionTargetLengths(styleDirective, sections);
  const expandedSections: string[] = [];
  const warnings: string[] = [...polished.warnings];

  for (let index = 0; index < sections.length; index += 1) {
    onProgress?.('expandSection', index + 1, sections.length);

    const outcome = await expandSectionWithRetries({
      aiService,
      section: sections[index] as string,
      skeleton: polished.text,
      previousSection: expandedSections.at(-1),
      targetLength: targetLengths[index] as number,
      characters: context.characters,
      options: withAttribution(
        { ...buildGenerateOptions(providers, 'sceneSectionExpansion'), styleDirective },
        { primary: sceneRef },
      ),
    });

    expandedSections.push(outcome.text);
    warnings.push(
      ...outcome.violations.map((violation) => `${index + 1}구간: ${violation.detail}`),
    );
    assertNotCancelled(shouldCancel);
  }

  const draftBody = expandedSections.join('\n\n');

  // 완성된 본문의 대사에 화자를 붙여 인물별 말투 코퍼스의 재료를 만든다. 저장은 호출자가 초안을
  // 쓴 뒤에 한다.
  const dialogueRecord = await buildDialogueRecord({
    aiService,
    draftBody,
    characters: context.characters,
    sceneStem: input.sceneStem,
    options: withAttribution(buildGenerateOptions(providers, 'sceneDialogueAttribution'), {
      primary: sceneRef,
    }),
    onProgress,
  });

  return {
    draftBody,
    skeleton: polished.text,
    warnings,
    detectedCharacters,
    personasUsed,
    providers,
    ...(dialogueRecord === undefined ? {} : { dialogueRecord }),
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
