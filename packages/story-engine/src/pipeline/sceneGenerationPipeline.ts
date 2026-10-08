import type {
  Background,
  CharacterCard,
  ProjectFormat,
  SceneContext,
  SceneDialogueRecord,
  EntityRef,
  StyleDirective,
} from '@storyboard/story-model';
import {
  characterCatchphrases,
  type GenerateTextOptions,
  type SceneDialogueRewrite,
} from '@storyboard/story-ai';
import { mergeDialogueRewrites, numberSkeletonDialogue } from './dialogueRewrites';
import {
  computeDraftBodyHash,
  createEmptyBackground,
  renderSceneCardBody,
  splitSceneNarrativeSource,
  unknownDialogueSpeaker,
} from '@storyboard/story-model';
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
  quotedDialoguePatternFor,
  splitSkeletonIntoSections,
  validateExpandedSection,
  validatePolishedSkeleton,
  validateSceneSkeleton,
  SECTION_OUTPUT_LIMIT,
  type SectionViolation,
} from './sceneSectionPlan';
import { selectRepresentativeDialogue } from './dialogueCorpus';
import {
  type DialoguePolishSummary,
  type RunSceneGenerationPipelineInput,
  type RunSceneGenerationPipelineResult,
  type SceneGenerationPipelineAiService,
  type SceneGenerationPipelineTaskProviders,
} from './sceneGenerationTypes';

export type {
  BackgroundMemoryStore,
  DialoguePolishSummary,
  PersonaMemoryStore,
  RunSceneGenerationPipelineInput,
  RunSceneGenerationPipelineResult,
  SceneGenerationPipelineAiService,
  SceneGenerationPipelineStage,
  SceneGenerationPipelineTaskProviders,
} from './sceneGenerationTypes';
export { SceneGenerationPipelineCancelledError } from './sceneGenerationTypes';

import { resolveSceneGenerationTuning } from './sceneGenerationTuning';
import type { ResolvedSceneGenerationTuning } from './sceneGenerationTuning';
import { resolveScenePipelinePlan, type SceneStageId } from './sceneStageCatalog';

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
  const sceneStem = input.sceneStem ?? input.context.scene.stem;
  const body = context.scene.body.trim();
  const narrativeParts = splitSceneNarrativeSource(
    renderNarrativeBodyWithCastNames(context) ?? body,
  );

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
    // 작법 블록은 사건 재료와 섞지 않는다 — 섞이면 같은 등장이 두 번 뽑히고 카드 메타가 산문에
    // 실린다 — 대신 뼈대에 «설계»로 따로 넘긴다.
    narrativeSource: narrativeParts.narrative,
    design: narrativeParts.design,
    tuning: resolveSceneGenerationTuning(input.tuning),
    condensedPreviousContext: condensePreviousContext(
      previousContext,
      input.useContextCondense === true,
      resolveSceneGenerationTuning(input.tuning).contextCondensedMaxChars,
    ),
    sceneRef: { kind: 'scene', id: sceneStem },
    detectedCharacters,
  };
}

// NOTE: 뼈대가 얇으면 살붙임이 감당 못 할 배율(15배)을 요구받아 분량이 미달한다. 최종 목표의
// 1/3을 뼈대에 배분해 확장이 3배 남짓이 되게 한다 — 비율은 skeletonRatio 손잡이가 갖는다.

function skeletonTargetLength(
  styleDirective: StyleDirective | undefined,
  skeletonRatio: number,
): number | undefined {
  const target = styleDirective?.targetWordCount;
  return target === undefined ? undefined : Math.round(target * skeletonRatio);
}

function sectionTargetLengths(
  styleDirective: StyleDirective | undefined,
  sections: readonly string[],
  outputLimit: number,
): number[] {
  const target = styleDirective?.targetWordCount ?? outputLimit * sections.length;
  return planSectionTargetLengths(sections, target, outputLimit);
}

// NOTE: 씬 간 연속성 재료(캐넌·이전 씬)는 사건을 정하는 뼈대 단계에만 넣는다. 살붙임은 뼈대만 보고
// 문장을 다듬으므로, 여기서 설정을 다시 보여 주면 묘사가 새 설정을 끌어들일 여지만 생긴다.
// 비트 좌표의 출연은 카드 id로 적힐 수 있다. 프롬프트에는 이름이 가야 하므로, 좌표 비트가 있는
// 씬만 이름으로 다시 렌더링한다. 씬 본문(해시·저장)은 그대로 둔다.
function renderNarrativeBodyWithCastNames(context: SceneContext): string | undefined {
  const card = context.scene.card;
  const hasCoordinates = (card?.beats ?? []).some((beat) => typeof beat !== 'string');
  if (card === undefined || !hasCoordinates) {
    return undefined;
  }

  const nameById = new Map(context.characters.map((character) => [character.id, character.name]));
  return renderSceneCardBody(card, context.scene.summaryText, (ref) => nameById.get(ref) ?? ref);
}

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

// 뼈대는 씬에서 가장 비싼 호출이라 한 번만 다시 부른다. 두 판 다 위반이면 가벼운 쪽을, 같은
// 무게면 목표 분량에 가까운 쪽을 남긴다 — 사건이 빠진 판보다는 겹친 판이 고치기 쉽고, 되풀이 없이
// 더 두꺼운 판이 살붙임의 부담을 덜어 준다.

async function draftSkeletonWithRetries(
  aiService: Pick<SceneGenerationPipelineAiService, 'draftSceneSkeleton'>,
  input: Parameters<SceneGenerationPipelineAiService['draftSceneSkeleton']>[0],
  options: GenerateTextOptions,
  retryLimit: number,
  tuning: ResolvedSceneGenerationTuning,
): Promise<string> {
  let reasons: string[] = [];
  let best: { text: string; weight: number; distance: number } | undefined;

  for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
    const skeleton = await aiService.draftSceneSkeleton(
      { ...input, ...(reasons.length > 0 ? { retryReasons: reasons } : {}) },
      options,
    );
    const violations = validateSceneSkeleton(skeleton, input.targetLength, tuning);

    if (violations.length === 0) {
      return skeleton;
    }

    const weight = weighViolations(violations, tuning.violationWeights);
    const distance =
      input.targetLength === undefined ? 0 : Math.abs(skeleton.length - input.targetLength);
    if (
      best === undefined ||
      weight < best.weight ||
      (weight === best.weight && distance < best.distance)
    ) {
      best = { text: skeleton, weight, distance };
    }

    reasons = violations.map((violation) => violation.detail);
  }

  return best?.text ?? '';
}

async function expandSectionWithRetries(input: {
  readonly aiService: Pick<SceneGenerationPipelineAiService, 'expandSceneSection'>;
  readonly section: string;
  readonly skeleton: string;
  readonly previousSection: string | undefined;
  readonly targetLength: number;
  readonly backgroundFacts: readonly string[];
  readonly characters: SceneContext['characters'];
  readonly options: GenerateTextOptions;
  readonly tuning: ResolvedSceneGenerationTuning;
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

  for (let attempt = 0; attempt <= input.tuning.sectionRetryLimit; attempt += 1) {
    const expanded = await input.aiService.expandSceneSection(
      {
        skeleton: input.skeleton,
        section: input.section,
        previousSection: input.previousSection,
        targetLength: input.targetLength,
        backgroundFacts: input.backgroundFacts,
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
      tuning: input.tuning,
    });

    if (violations.length === 0) {
      return { text: expanded, violations: [] };
    }

    // 같은 무게라면 목표 분량에 가까운 판이 낫다. 재시도는 대개 분량을 더 쓰라는 지시를 받고 도는데,
    // 무조건 첫 판을 남기면 그 개선분을 버리게 된다.
    const weight = weighViolations(violations, input.tuning.violationWeights);
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
function weighViolations(
  violations: readonly SectionViolation[],
  weights: ResolvedSceneGenerationTuning['violationWeights'],
): number {
  return violations.reduce((total, violation) => total + weights[violation.kind], 0);
}

// NOTE: 다듬기가 사건을 늘리면 씬 전체가 오염되므로, 위반이 남은 다듬기는 뼈대 대사로 되돌린다.
// 대사 개성은 덜해도 사건은 안전하고, 되돌린 사실은 헤더 경고로 알린다.

// 인물 하나에 호출 하나. 각 호출은 자기 인물의 페르소나·입버릇·말투 표본·아는 것만 받고, 번호로
// 가리킨 자기 대사만 돌려준다. 병합은 번호 기준이고 두 인물이 같은 번호를 가져가면 뼈대가 이긴다.
//
// NOTE: 검증은 인물마다 따로 한다. 그 인물의 재작성만 뼈대에 넣어 보고, 위반이면 그 인물만 사유를
// 실어 다시 부른다. 한 판을 통째로 검증하면 한 인물의 실수가 나머지 인물의 다듬기까지 버리고, 다시
// 돌릴 때도 문제없던 인물의 호출을 되풀이하게 된다. 한도를 다 쓰고도 위반인 인물은 그 인물만
// 뼈대 대사로 남는다.
async function polishDialogueOrKeepSkeleton(input: {
  readonly aiService: Pick<SceneGenerationPipelineAiService, 'polishSceneDialogue'>;
  readonly skeleton: string;
  readonly personas: ReadonlyMap<string, string>;
  readonly voiceSamples: ReadonlyMap<string, readonly string[]>;
  readonly characterKnowledge: ReadonlyMap<string, readonly string[]> | undefined;
  readonly characterRelations: ReadonlyMap<string, readonly string[]> | undefined;
  readonly characters: SceneContext['characters'];
  readonly options: GenerateTextOptions;
  readonly tuning: ResolvedSceneGenerationTuning;
  readonly onProgress: RunSceneGenerationPipelineInput['onProgress'];
}): Promise<{
  readonly text: string;
  readonly warnings: readonly string[];
  readonly summary: DialoguePolishSummary | undefined;
}> {
  const numbered = numberSkeletonDialogue(input.skeleton, input.tuning);
  const speakers = [...input.personas.keys()];

  if (numbered.dialogues.length === 0 || speakers.length === 0) {
    input.onProgress?.('polishDialogue', 1, 1);
    return { text: input.skeleton, warnings: [], summary: undefined };
  }

  const catchphrases = characterCatchphrases(input.characters);
  const speechToOthers = characterSpeechToOthers(input.characters);
  const validateAgainstSkeleton = (polished: string): SectionViolation[] =>
    validatePolishedSkeleton({
      skeleton: input.skeleton,
      polished,
      characters: input.characters,
      lengthLimit: input.skeleton.length * input.tuning.polishLengthLimitRatio,
      tuning: input.tuning,
    });

  const accepted = new Map<string, readonly SceneDialogueRewrite[]>();
  const rejected = new Map<string, readonly SectionViolation[]>();
  const truncated = new Set<string>();
  let pending = speakers;

  // NOTE: 뼈대·구간은 attempt <= retryLimit 로 돌고 다듬기만 < 로 돈다. 같은 값이 호출 수를 하나
  // 다르게 만드므로, 손잡이를 비교할 때 두 계열을 나란히 놓지 않는다. 첫 판은 인물 수만큼, 그 뒤
  // 판은 위반한 인물 수만큼의 호출이다.
  for (
    let attempt = 0;
    attempt < input.tuning.polishRetryLimit && pending.length > 0;
    attempt += 1
  ) {
    const failing: string[] = [];

    for (const [position, name] of pending.entries()) {
      input.onProgress?.('polishDialogue', position + 1, pending.length);
      const retryReasons = rejected.get(name)?.map((violation) => violation.detail);
      const response = await input.aiService.polishSceneDialogue(
        {
          numberedSkeleton: numbered.text,
          character: {
            name,
            persona: input.personas.get(name) ?? '',
            catchphrases: catchphrases.get(name) ?? [],
            samples: input.voiceSamples.get(name) ?? [],
            knowledge: input.characterKnowledge?.get(name) ?? [],
            speechToOthers: speechToOthers.get(name) ?? [],
            relationChanges: input.characterRelations?.get(name) ?? [],
          },
          otherCharacters: speakers.filter((other) => other !== name),
          ...(retryReasons === undefined ? {} : { retryReasons }),
        },
        input.options,
      );

      if (response.isTruncated) {
        truncated.add(name);
      } else {
        truncated.delete(name);
      }

      const solo = mergeDialogueRewrites(
        input.skeleton,
        numbered,
        new Map([[name, response.rewrites]]),
      );
      const violations = validateAgainstSkeleton(solo.text);

      if (violations.length === 0) {
        accepted.set(name, response.rewrites);
        rejected.delete(name);
      } else {
        rejected.set(name, violations);
        failing.push(name);
      }
    }

    pending = failing;
  }

  const warnings = [
    ...[...rejected.entries()].map(
      ([name, violations]) =>
        `${name}의 대사 다듬기를 되돌렸습니다 — ${violations.map((violation) => violation.detail).join(' / ')}`,
    ),
    ...[...truncated]
      .filter((name) => !rejected.has(name))
      .map(
        (name) => `${name}의 대사 다듬기 응답이 출력 한도에서 잘려 일부 대사를 손보지 못했습니다`,
      ),
  ];

  const merged = mergeDialogueRewrites(input.skeleton, numbered, accepted);
  const combinedViolations = validateAgainstSkeleton(merged.text);

  // 인물마다 통과했어도 합친 결과가 길이 한도를 넘을 수 있다. 그때는 종전처럼 씬 전체를 되돌린다.
  if (combinedViolations.length > 0) {
    return {
      text: input.skeleton,
      warnings: [
        ...warnings,
        ...combinedViolations.map(
          (violation) => `대사 다듬기를 되돌렸습니다 — ${violation.detail}`,
        ),
      ],
      summary: { lineCount: numbered.dialogues.length, polishedCount: 0, contestedCount: 0 },
    };
  }

  return {
    text: merged.text,
    warnings: [
      ...warnings,
      ...(merged.contestedIndices.length === 0
        ? []
        : [
            `대사 ${merged.contestedIndices.join(', ')}번은 두 인물이 자기 대사라고 해 뼈대 그대로 두었습니다`,
          ]),
    ],
    summary: {
      lineCount: numbered.dialogues.length,
      polishedCount: merged.replacedCount,
      contestedCount: merged.contestedIndices.length,
    },
  };
}

// 카드 relations 의 speech("반말"·"존댓말"·"형이라 부르며 반말")를 "상대에게: 말투" 줄로 만든다.
// 상대는 이 씬에 있는 인물만이다. 씬에 없는 상대의 규칙은 이 호출이 쓸 일이 없다.
function characterSpeechToOthers(
  characters: SceneContext['characters'],
): ReadonlyMap<string, readonly string[]> {
  const nameById = new Map(characters.map((character) => [character.id, character.name]));
  const lines = new Map<string, readonly string[]>();

  for (const character of characters) {
    const rules = (character.relations ?? []).flatMap((relation) => {
      const target = nameById.get(relation.target);
      return relation.speech && target ? [`${target}에게: ${relation.speech}`] : [];
    });
    if (rules.length > 0) {
      lines.set(character.name, rules);
    }
  }

  return lines;
}

function extractDialogueLines(text: string, tuning: ResolvedSceneGenerationTuning): string[] {
  return [...text.matchAll(quotedDialoguePatternFor(tuning.dialogueMinimumQuotedLength))].map(
    (match) => (match[1] ?? '').trim(),
  );
}

// NOTE: 페르소나 맵은 인물 이름으로 묶여 있고 사이드카는 카드 id로 묶여 있다. 다듬기 프롬프트가
// 이름 블록을 쓰므로 여기서 이름 기준으로 옮겨 담는다.
async function buildVoiceSamples(
  characters: readonly CharacterCard[],
  dialogueCorpus: RunSceneGenerationPipelineInput['dialogueCorpus'],
  sceneStem: string | undefined,
  tuning: ResolvedSceneGenerationTuning,
): Promise<Map<string, readonly string[]>> {
  const voiceSamples = new Map<string, readonly string[]>();

  if (!dialogueCorpus) {
    return voiceSamples;
  }

  const corpus = await dialogueCorpus.loadCorpus();

  for (const character of characters) {
    const samples = selectRepresentativeDialogue(
      corpus,
      character.id,
      sceneStem ?? '',
      tuning.voiceSampleLimit,
      {
        minimumLength: tuning.voiceSampleMinimumLength,
        maximumLength: tuning.voiceSampleMaximumLength,
      },
    );
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
  readonly tuning: ResolvedSceneGenerationTuning;
}): Promise<SceneDialogueRecord | undefined> {
  const { sceneStem } = input;

  if (!sceneStem) {
    return undefined;
  }

  const lines = extractDialogueLines(input.draftBody, input.tuning);
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

// The run state every stage reads and writes. A stage that is switched off leaves its slot at the
// value below, which is what the later stages then see: no polish means the skeleton goes to
// expansion as it is, no voice samples means an empty map.
interface SceneRunState {
  readonly input: RunSceneGenerationPipelineInput;
  readonly ctx: ResolvedExecutionContext;
  personasUsed: Map<string, string>;
  background: Background;
  voiceSamples: Map<string, readonly string[]>;
  skeleton: string;
  polishedText: string;
  dialoguePolish: DialoguePolishSummary | undefined;
  readonly warnings: string[];
  draftBody: string;
  dialogueRecord: SceneDialogueRecord | undefined;
}

export interface ISceneStage {
  readonly id: SceneStageId;
  run(state: SceneRunState): Promise<void>;
}

const buildPersonasStage: ISceneStage = {
  id: 'buildPersonas',
  async run(state) {
    const { ctx, input } = state;
    state.personasUsed = await buildScenePersonas(
      ctx.context.characters,
      {
        ...buildGenerateOptions(ctx.providers, 'personaGeneration'),
        styleDirective: ctx.styleDirective,
      },
      ctx.aiService,
      input.personaStore,
      ctx.sceneRef,
      ctx.onProgress,
      ctx.shouldCancel,
    );
  },
};

const describeBackgroundStage: ISceneStage = {
  id: 'describeBackground',
  async run(state) {
    const { ctx, input } = state;

    if (ctx.context.background) {
      state.background = await describeBackgroundForScene(
        ctx.context.background,
        ctx.aiService,
        input.backgroundStore,
        input.backgroundRecentExcerpt,
      );
    }
    assertNotCancelled(ctx.shouldCancel);
  },
};

const collectVoiceSamplesStage: ISceneStage = {
  id: 'collectVoiceSamples',
  async run(state) {
    const { ctx, input } = state;
    state.voiceSamples = await buildVoiceSamples(
      ctx.context.characters,
      input.dialogueCorpus,
      input.sceneStem,
      ctx.tuning,
    );
  },
};

// 1단계. 사건·등장·종료 지점을 한 문맥에서 확정한다. 이후 단계는 문장만 다듬으므로 연속성이 깨지지 않는다.
const draftSkeletonStage: ISceneStage = {
  id: 'draftSkeleton',
  async run(state) {
    const { ctx, input } = state;
    ctx.onProgress?.('draftSkeleton', 1, 1);
    state.skeleton = await draftSkeletonWithRetries(
      ctx.aiService,
      {
        narrativeSource: ctx.narrativeSource,
        ...(ctx.design.length > 0 ? { design: ctx.design } : {}),
        personas: state.personasUsed,
        catchphrases: characterCatchphrases(ctx.context.characters),
        characterKnowledge: input.characterKnowledge,
        background: state.background,
        previousContext: buildSkeletonContext(ctx.condensedPreviousContext, input.canonFactLines),
        endState: ctx.context.scene.card?.endState,
        grounding: ctx.context.scene.frontmatter.grounding,
        targetLength: skeletonTargetLength(ctx.styleDirective, ctx.tuning.skeletonRatio),
      },
      withAttribution(
        {
          ...buildGenerateOptions(ctx.providers, 'sceneSkeleton'),
          styleDirective: ctx.styleDirective,
        },
        { primary: ctx.sceneRef },
      ),
      ctx.tuning.skeletonRetryLimit,
      ctx.tuning,
    );
    state.polishedText = state.skeleton;
    assertNotCancelled(ctx.shouldCancel);
  },
};

// 2단계. 대사의 말투만 손본다. 턴을 늘리지는 않는다. 대화 밀도는 뼈대가 정한 대로 간다.
const polishDialogueStage: ISceneStage = {
  id: 'polishDialogue',
  async run(state) {
    const { ctx } = state;
    const polished = await polishDialogueOrKeepSkeleton({
      aiService: ctx.aiService,
      skeleton: state.skeleton,
      personas: state.personasUsed,
      voiceSamples: state.voiceSamples,
      characterKnowledge: state.input.characterKnowledge,
      characterRelations: state.input.characterRelations,
      characters: ctx.context.characters,
      onProgress: ctx.onProgress,
      options: withAttribution(
        {
          ...buildGenerateOptions(ctx.providers, 'sceneDialoguePolish'),
          styleDirective: ctx.styleDirective,
        },
        { primary: ctx.sceneRef },
      ),
      tuning: ctx.tuning,
    });
    state.polishedText = polished.text;
    state.dialoguePolish = polished.summary;
    state.warnings.push(...polished.warnings);
    assertNotCancelled(ctx.shouldCancel);
  },
};

// NOTE: 씬 사이 재료(원장·캐넌·이전 맥락)는 뼈대만 보지만, 이 씬의 배경 카드가 적은 공간 사실은
// 살붙임도 본다. 뼈대만 보고 살을 붙이면 해외 콘도 12층이 장판·옥상 계단이 있는 한국 아파트로
// 일반화됐다(#88-11). 배경의 사실은 새 설정이 아니라 이미 확정된 설정이다.
function backgroundFactLines(background: Background): string[] {
  const header = [background.time, background.weather]
    .filter((part): part is string => Boolean(part && part.trim().length > 0))
    .join(', ');

  return [
    ...(header.length > 0 ? [header] : []),
    ...(background.description ?? []),
    ...(background.senses ?? []),
  ].filter((line) => line.trim().length > 0);
}

// 3단계. 뼈대를 구간으로 나눠 살을 붙인다. 매 호출이 뼈대 전문과 직전 구간 완성문을 함께 본다.
const expandSectionStage: ISceneStage = {
  id: 'expandSection',
  async run(state) {
    const { ctx, input } = state;
    const outputLimit = input.sectionOutputLimit ?? SECTION_OUTPUT_LIMIT;
    const sections = splitSkeletonIntoSections(
      state.polishedText,
      planSectionCount(ctx.styleDirective?.targetWordCount ?? 0, outputLimit),
    );
    const targetLengths = sectionTargetLengths(ctx.styleDirective, sections, outputLimit);
    const expandedSections: string[] = [];

    for (let index = 0; index < sections.length; index += 1) {
      ctx.onProgress?.('expandSection', index + 1, sections.length);

      const outcome = await expandSectionWithRetries({
        aiService: ctx.aiService,
        section: sections[index] as string,
        skeleton: state.polishedText,
        previousSection: expandedSections.at(-1),
        targetLength: targetLengths[index] as number,
        backgroundFacts: backgroundFactLines(state.background),
        characters: ctx.context.characters,
        options: withAttribution(
          {
            ...buildGenerateOptions(ctx.providers, 'sceneSectionExpansion'),
            styleDirective: ctx.styleDirective,
          },
          { primary: ctx.sceneRef },
        ),
        tuning: ctx.tuning,
      });

      expandedSections.push(outcome.text);
      state.warnings.push(
        ...outcome.violations.map((violation) => `${index + 1}구간: ${violation.detail}`),
      );
      assertNotCancelled(ctx.shouldCancel);
    }

    state.draftBody = expandedSections.join('\n\n');
  },
};

// 완성된 본문의 대사에 화자를 붙여 인물별 말투 코퍼스의 재료를 만든다. 저장은 호출자가 초안을
// 쓴 뒤에 한다.
const attributeDialogueStage: ISceneStage = {
  id: 'attributeDialogue',
  async run(state) {
    const { ctx, input } = state;
    state.dialogueRecord = await buildDialogueRecord({
      aiService: ctx.aiService,
      draftBody: state.draftBody,
      characters: ctx.context.characters,
      sceneStem: input.sceneStem,
      options: withAttribution(buildGenerateOptions(ctx.providers, 'sceneDialogueAttribution'), {
        primary: ctx.sceneRef,
      }),
      onProgress: ctx.onProgress,
      tuning: ctx.tuning,
    });
  },
};

export const sceneStages: Readonly<Record<SceneStageId, ISceneStage>> = {
  buildPersonas: buildPersonasStage,
  describeBackground: describeBackgroundStage,
  collectVoiceSamples: collectVoiceSamplesStage,
  draftSkeleton: draftSkeletonStage,
  polishDialogue: polishDialogueStage,
  expandSection: expandSectionStage,
  attributeDialogue: attributeDialogueStage,
};

// Runs the stages the plan names, in its order, over one run state. The plan is the author's
// `pipelines/scene.yaml` when one is in force, otherwise the bundled catalog order.
async function executeSceneGenerationPipeline(
  input: RunSceneGenerationPipelineInput,
): Promise<RunSceneGenerationPipelineResult> {
  const ctx = resolveExecutionContext(input);
  const plan = input.stages ?? resolveScenePipelinePlan();
  const state: SceneRunState = {
    input,
    ctx,
    personasUsed: new Map(),
    background: createEmptyBackground('scene-default', '미정'),
    voiceSamples: new Map(),
    skeleton: '',
    polishedText: '',
    dialoguePolish: undefined,
    warnings: [],
    draftBody: '',
    dialogueRecord: undefined,
  };

  for (const id of plan) {
    await sceneStages[id].run(state);
  }

  return {
    draftBody: state.draftBody,
    skeleton: state.polishedText,
    warnings: state.warnings,
    detectedCharacters: ctx.detectedCharacters,
    personasUsed: state.personasUsed,
    providers: ctx.providers,
    ...(state.dialogueRecord === undefined ? {} : { dialogueRecord: state.dialogueRecord }),
    ...(state.dialoguePolish === undefined ? {} : { dialoguePolish: state.dialoguePolish }),
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
