import type {
  Background,
  BackgroundFactConflict,
  CharacterCard,
  ProjectFormat,
  SceneContext,
  SceneBeat,
  SceneDialogueRecord,
  EntityRef,
  StyleDirective,
} from '@storyboard/story-model';
import {
  characterCatchphrases,
  type GenerateTextOptions,
  type SceneDialogueRewrite,
} from '@storyboard/story-ai';
import {
  claimableRewriteText,
  mergeDialogueRewrites,
  numberSkeletonDialogue,
} from './dialogueRewrites';
import {
  computeDraftBodyHash,
  createEmptyBackground,
  formatBackgroundFactConflict,
  renderSceneCardBody,
  splitSceneNarrativeSource,
  unknownDialogueSpeaker,
} from '@storyboard/story-model';
import { condensePreviousContext } from './sceneGenerationPolicies';
import {
  countMissingSceneCoordinates,
  extractSceneCoordinates,
  hasSceneCoordinates,
  listSceneCoordinates,
  sceneCoordinatesFromBeats,
  sectionSceneCoordinates,
  type SceneCoordinateLedger,
} from './sceneCoordinates';
import {
  assertNotCancelled,
  buildGenerateOptions,
  buildScenePersonas,
  describeBackgroundForScene,
  findBackgroundFactConflictsForScene,
  withAttribution,
} from './sceneGenerationStages';
import {
  describeThinExpansionSpots,
  findCatchphraseOveruse,
  findThinExpansionSpots,
  findPolishedLineViolations,
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
  applyPlannedSceneBreaks,
  countSceneBreakLines,
  findThinDialogueBeats,
  planSceneBreaks,
  renderPlannedNarrative,
  restoreSceneBreaks,
  type SceneBreakPlan,
} from './sceneBreakPlan';
import {
  type DialoguePolishSummary,
  type RunSceneGenerationPipelineInput,
  type RunSceneGenerationPipelineResult,
  type SceneGenerationPipelineAiService,
  type SceneGenerationPipelineTaskProviders,
} from './sceneGenerationTypes';

export type {
  BackgroundFactConflictStore,
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
  const sceneStem = input.sceneStem ?? input.context.scene.stem;
  const body = context.scene.body.trim();
  const narrativeParts = splitSceneNarrativeSource(
    renderNarrativeBodyWithCastNames(context) ?? body,
  );
  const tuning = resolveSceneGenerationTuning(input.tuning);
  const beats = context.scene.card?.beats ?? [];
  const breakPlan = planSceneBreaks(beats, castNameOf(context), tuning.sceneBreakTimeJumpMinutes);

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
function castNameOf(context: SceneContext): (ref: string) => string {
  const nameById = new Map(context.characters.map((character) => [character.id, character.name]));
  return (ref) => nameById.get(ref) ?? ref;
}

function renderNarrativeBodyWithCastNames(context: SceneContext): string | undefined {
  const card = context.scene.card;
  const hasCoordinates = (card?.beats ?? []).some((beat) => typeof beat !== 'string');
  if (card === undefined || !hasCoordinates) {
    return undefined;
  }

  return renderSceneCardBody(card, context.scene.summaryText, castNameOf(context));
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
  breakPlan: SceneBreakPlan | undefined,
  beats: readonly SceneBeat[],
): Promise<{ readonly text: string; readonly violations: readonly SectionViolation[] }> {
  let reasons: string[] = [];
  let best:
    | { text: string; violations: readonly SectionViolation[]; weight: number; distance: number }
    | undefined;

  for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
    const skeleton = await aiService.draftSceneSkeleton(
      { ...input, ...(reasons.length > 0 ? { retryReasons: reasons } : {}) },
      options,
    );
    const violations = [
      ...validateSceneSkeleton(skeleton, input.targetLength, tuning),
      ...validatePlannedSceneBreaks(skeleton, breakPlan),
    ];

    if (violations.length === 0) {
      return { text: skeleton, violations: [] };
    }

    const weight = weighViolations(violations, tuning.violationWeights);
    const distance =
      input.targetLength === undefined ? 0 : Math.abs(skeleton.length - input.targetLength);
    if (
      best === undefined ||
      weight < best.weight ||
      (weight === best.weight && distance < best.distance)
    ) {
      best = { text: skeleton, violations, weight, distance };
    }

    reasons = [
      ...violations.map((violation) => violation.detail),
      ...thinDialogueReasons(skeleton, violations, breakPlan, beats, tuning),
    ];
  }

  return { text: best?.text ?? '', violations: best?.violations ?? [] };
}

const thinBeatListLimit = 6;

// 미달 뼈대를 다시 부를 때 어느 사건을 더 펼칠지 지목한다(#115). 대목이 없는 씬은 지목할 수 없다.
function thinDialogueReasons(
  skeleton: string,
  violations: readonly SectionViolation[],
  breakPlan: SceneBreakPlan | undefined,
  beats: readonly SceneBeat[],
  tuning: ResolvedSceneGenerationTuning,
): string[] {
  if (breakPlan === undefined || !violations.some((violation) => violation.kind === 'too-short')) {
    return [];
  }

  const thin = findThinDialogueBeats(skeleton, breakPlan, beats, tuning.skeletonThinDialogueTurns);
  if (thin.length === 0) {
    return [];
  }

  const listed = thin
    .slice(0, thinBeatListLimit)
    .map((text) => `«${text}»`)
    .join('·');
  return [
    `사건 ${listed}${thin.length > thinBeatListLimit ? ` 외 ${thin.length - thinBeatListLimit}개` : ''}의 대화가 짧습니다. 이 사건들은 각각 ${tuning.skeletonRequestedDialogueTurns}턴 이상 밀고 당기게 늘리세요`,
  ];
}

// 표식을 빠뜨린 뼈대는 그 대목이 앞 대목에 붙어 전환이 사라진다. 다시 부를 이유로 삼는다.
function validatePlannedSceneBreaks(
  skeleton: string,
  breakPlan: SceneBreakPlan | undefined,
): SectionViolation[] {
  if (breakPlan === undefined) {
    return [];
  }

  const { missingMarkers } = applyPlannedSceneBreaks(skeleton, breakPlan);
  return missingMarkers === 0
    ? []
    : [
        {
          kind: 'scene-breaks',
          detail: `⟪대목 n⟫ 표식 ${missingMarkers}개가 빠져 그 대목이 앞 대목에 붙었습니다. 사건 목록의 ⟪대목⟫ 줄을 모두 그 자리에 옮겨 적으세요`,
        },
      ];
}

async function expandSectionWithRetries(input: {
  readonly aiService: Pick<SceneGenerationPipelineAiService, 'expandSceneSection'>;
  readonly section: string;
  readonly skeleton: string;
  readonly previousSection: string | undefined;
  readonly targetLength: number;
  readonly backgroundFacts: readonly string[];
  readonly backgroundConflicts: readonly string[];
  readonly sceneCoordinates: readonly string[];
  readonly characters: SceneContext['characters'];
  readonly options: GenerateTextOptions;
  readonly tuning: ResolvedSceneGenerationTuning;
}): Promise<{ readonly text: string; readonly violations: readonly SectionViolation[] }> {
  let reasons: string[] = [];
  let isUnderLengthRetry = false;
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
        backgroundConflicts: input.backgroundConflicts,
        sceneCoordinates: input.sceneCoordinates,
        retryReasons: reasons,
        isUnderLengthRetry,
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

    isUnderLengthRetry = violations.some((violation) => violation.kind === 'too-short');
    const thinSpots = isUnderLengthRetry
      ? describeThinExpansionSpots(
          findThinExpansionSpots(input.section, expanded, input.tuning.dialogueMinimumQuotedLength),
        )
      : undefined;
    reasons = [
      ...violations.map((violation) => violation.detail),
      ...(thinSpots === undefined ? [] : [thinSpots]),
    ];
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
// 다른 인물마다 카드 voice 의 첫 줄. 페르소나 전문과 아는 것은 그 인물의 호출만 받는다.
function otherVoices(
  characters: readonly CharacterCard[],
  name: string,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    characters.flatMap((character) => {
      const voice = character.voice?.[0]?.trim();
      return character.name === name || voice === undefined || voice.length === 0
        ? []
        : [[character.name, voice]];
    }),
  );
}

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
  // 위반한 번호를 뺀 나머지가 씬 검증을 통과하면, 재시도가 끝내 실패해도 그 나머지는 받는다.
  const partial = new Map<
    string,
    { rewrites: readonly SceneDialogueRewrite[]; heldBack: number }
  >();
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
          otherVoices: otherVoices(input.characters, name),
          ...(retryReasons === undefined ? {} : { retryReasons }),
        },
        input.options,
      );

      if (response.isTruncated) {
        truncated.add(name);
      } else {
        truncated.delete(name);
      }

      const lines = new Map(
        response.rewrites.flatMap((rewrite) => {
          const text = claimableRewriteText(rewrite, numbered);
          return text === undefined ? [] : [[rewrite.index, text] as const];
        }),
      );
      const lineViolations = findPolishedLineViolations({
        skeleton: input.skeleton,
        lines,
        characters: input.characters,
        tuning: input.tuning,
      });
      const kept = response.rewrites.filter((rewrite) => !lineViolations.has(rewrite.index));
      const solo = mergeDialogueRewrites(input.skeleton, numbered, new Map([[name, kept]]));
      const sceneViolations = validateAgainstSkeleton(solo.text);
      const violations = [...[...lineViolations.values()].flat(), ...sceneViolations];

      if (violations.length === 0) {
        accepted.set(name, response.rewrites);
        rejected.delete(name);
        partial.delete(name);
      } else {
        rejected.set(name, violations);
        failing.push(name);
        if (sceneViolations.length === 0) {
          partial.set(name, { rewrites: kept, heldBack: lineViolations.size });
        } else {
          partial.delete(name);
        }
      }
    }

    pending = failing;
  }

  for (const [name, kept] of partial) {
    accepted.set(name, kept.rewrites);
  }

  const warnings = [
    ...[...rejected.entries()].map(([name, violations]) => {
      const details = violations.map((violation) => violation.detail).join(' / ');
      const kept = partial.get(name);
      return kept === undefined
        ? `${name}의 대사 다듬기를 되돌렸습니다 — ${details}`
        : `${name}의 대사 ${kept.heldBack}개를 뼈대대로 두었습니다 — ${details}`;
    }),
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
  const seeds = (await dialogueCorpus.loadVoiceSeeds?.())?.characters ?? {};
  const bounds = {
    minimumLength: tuning.voiceSampleMinimumLength,
    maximumLength: tuning.voiceSampleMaximumLength,
  };

  for (const character of characters) {
    const fromDrafts = selectRepresentativeDialogue(
      corpus,
      character.id,
      sceneStem ?? '',
      tuning.voiceSampleLimit,
      bounds,
    );
    // 작품의 대사가 쌓일수록 노트의 예시 대사는 자리를 내준다.
    const fromNotes = (seeds[character.id] ?? []).filter(
      (line) =>
        line.length >= bounds.minimumLength &&
        line.length <= bounds.maximumLength &&
        !fromDrafts.includes(line),
    );
    const samples = [...fromDrafts, ...fromNotes].slice(0, tuning.voiceSampleLimit);
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
  backgroundFactConflicts: readonly BackgroundFactConflict[];
  voiceSamples: Map<string, readonly string[]>;
  skeleton: string;
  sceneCoordinates: SceneCoordinateLedger;
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

// NOTE: 노트 흡수가 남긴 배경 카드의 상충은 흡수 때만 경고됐다(#88). 이미 있는 카드도 여기서 한 번
// 판정해 경고하고, 뼈대·살붙임이 둘 중 사건에 맞는 하나만 쓰도록 짝을 넘긴다(#108).
const checkBackgroundFactsStage: ISceneStage = {
  id: 'checkBackgroundFacts',
  async run(state) {
    const { ctx, input } = state;
    const card = ctx.context.background;

    if (card) {
      state.backgroundFactConflicts = await findBackgroundFactConflictsForScene(
        card,
        ctx.aiService,
        input.backgroundFactConflictStore,
      );
      state.warnings.push(
        ...state.backgroundFactConflicts.map(
          (conflict) =>
            `배경 «${card.name}»: ${formatBackgroundFactConflict(conflict)}는 함께 참일 수 없어 사건에 맞는 쪽만 씁니다.`,
        ),
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
    const skeleton = await draftSkeletonWithRetries(
      ctx.aiService,
      {
        narrativeSource: ctx.narrativeSource,
        ...(ctx.design.length > 0 ? { design: ctx.design } : {}),
        personas: state.personasUsed,
        catchphrases: characterCatchphrases(ctx.context.characters),
        characterKnowledge: input.characterKnowledge,
        background: state.background,
        backgroundConflicts: state.backgroundFactConflicts.map(formatBackgroundFactConflict),
        previousContext: buildSkeletonContext(ctx.condensedPreviousContext, input.canonFactLines),
        endState: ctx.context.scene.card?.endState,
        grounding: ctx.context.scene.frontmatter.grounding,
        targetLength: skeletonTargetLength(ctx.styleDirective, ctx.tuning.skeletonRatio),
        ...(ctx.breakPlan === undefined ? {} : { plannedBreaks: true }),
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
      ctx.breakPlan,
      ctx.context.scene.card?.beats ?? [],
    );
    state.warnings.push(...skeleton.violations.map((violation) => `뼈대: ${violation.detail}`));

    // 전환 자리를 파이프라인이 정한 씬은 장부도 그 대목들이다. 표식이 빠진 대목은 앞 대목에 붙었다.
    const applied =
      ctx.breakPlan === undefined
        ? undefined
        : applyPlannedSceneBreaks(skeleton.text, ctx.breakPlan);
    if (applied !== undefined && !applied.hasNoMarkers) {
      state.skeleton = applied.text;
      state.sceneCoordinates = { segments: applied.coordinates, isAlignedWithBreaks: true };
      state.polishedText = state.skeleton;
      assertNotCancelled(ctx.shouldCancel);
      return;
    }

    const extracted = extractSceneCoordinates(skeleton.text);
    state.skeleton = extracted.text;
    const missingCoordinates = countMissingSceneCoordinates(extracted.ledger);
    if (hasSceneCoordinates(extracted.ledger) && missingCoordinates === 0) {
      state.sceneCoordinates = extracted.ledger;
    } else {
      state.sceneCoordinates = sceneCoordinatesFromBeats(
        ctx.context.scene.card?.beats,
        castNameOf(ctx.context),
      );
      if (hasSceneCoordinates(extracted.ledger)) {
        state.warnings.push(
          `뼈대: 장면 표식이 ${missingCoordinates}곳 빠져 비트의 좌표를 대신 씁니다.`,
        );
      }
    }
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

// 재시도로도 --- 수가 맞지 않으면 뼈대 조각을 기준으로 되살린다(#112). 자리를 찾으면 그 위반은
// 경고 한 줄로 바뀌고, 못 찾으면 위반이 그대로 경고로 남는다.
function restoreSectionBreaks(
  section: string,
  outcome: { readonly text: string; readonly violations: readonly SectionViolation[] },
): { readonly text: string; readonly violations: readonly SectionViolation[] } {
  if (!outcome.violations.some((violation) => violation.kind === 'scene-breaks')) {
    return outcome;
  }

  const restored = restoreSceneBreaks(section, outcome.text);
  if (restored === undefined || countSceneBreakLines(restored) !== countSceneBreakLines(section)) {
    return outcome;
  }

  return {
    text: restored,
    violations: [
      ...outcome.violations.filter((violation) => violation.kind !== 'scene-breaks'),
      {
        kind: 'scene-breaks',
        detail: `살붙임이 바꾼 장면 전환(---)을 뼈대 조각의 자리에 맞춰 되살렸습니다`,
      },
    ],
  };
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
    const coordinatesBySection = sectionSceneCoordinates(state.sceneCoordinates, sections);
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
        backgroundConflicts: state.backgroundFactConflicts.map(formatBackgroundFactConflict),
        sceneCoordinates: coordinatesBySection[index] ?? [],
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

      const repaired = restoreSectionBreaks(sections[index] as string, outcome);
      expandedSections.push(repaired.text);
      state.warnings.push(
        ...repaired.violations.map((violation) => `${index + 1}구간: ${violation.detail}`),
      );
      assertNotCancelled(ctx.shouldCancel);
    }

    state.draftBody = expandedSections.join('\n\n');
    state.warnings.push(
      ...findCatchphraseOveruse({
        text: state.draftBody,
        characters: ctx.context.characters,
        beatCount: ctx.context.scene.card?.beats?.length ?? 0,
        tuning: ctx.tuning,
      }),
    );
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
  checkBackgroundFacts: checkBackgroundFactsStage,
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
    backgroundFactConflicts: [],
    voiceSamples: new Map(),
    skeleton: '',
    sceneCoordinates: { segments: [], isAlignedWithBreaks: true },
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
    sceneCoordinates: listSceneCoordinates(state.sceneCoordinates),
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
