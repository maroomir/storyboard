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
SceneNarrativeParts,
SceneCoverageIssue,
BackgroundCard,
SceneCard,
CharacterRef,
} from '@storyboard/story-model';
import {
  characterCatchphrases,
  type GenerateTextOptions,
  type SceneBeatCharacter,
  type SceneBeatDirective,
  type SceneBeatPassage,
  type SceneBeatProposal,
  type SceneBeatVerdict,
  type SceneDialoguePolishResult,
  type SceneDialogueRewrite,
} from '@storyboard/story-ai';
import {
  addBeatNote,
  assembleActedSkeleton,
  beatRetryReasons,
  findBeatCatchphraseOveruse,
  findOverlongLines,
  liveBeatNotes,
  nextActedBeats,
  planActedBeats,
  previousPassagesForJudge,
  priorPassages,
  shouldNoteScore,
  toBeatDirective,
  witnessedPassages,
  type ActedBeat,
  type BeatNote,
} from './beatActors';
import {
  claimableRewriteText,
  mergeDialogueRewrites,
  numberSkeletonDialogue,
type DialogueRewriteMerge,
type NumberedSkeleton,
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
import { scopeBackgroundFacts } from './sectionBackgroundFacts';
import {
  countMissingSceneCoordinates,
  extractSceneCoordinates,
  hasSceneCoordinates,
  listSceneCoordinates,
  sceneCoordinatesFromBeats,
  sectionPlaces,
  sectionSceneCoordinates,
  type ExtractedSceneCoordinates,
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
  countRecapPhrases,
  describeThinExpansionSpots,
  findCatchphraseOveruse,
  findRunAheadDialogue,
  findThinExpansionSpots,
  findPolishedLineViolations,
  planSectionCount,
  planSectionTargetLengths,
  quotedDialoguePatternFor,
  splitSkeletonIntoSections,
  trimRunAheadDialogue,
  validateExpandedSection,
  validatePolishedSkeleton,
  validateSceneSkeleton,
  SECTION_OUTPUT_LIMIT,
  type SectionViolation,
} from './sceneSectionPlan';
import { selectRepresentativeDialogue, type VoiceSampleBounds } from './dialogueCorpus';
import {
  applyPlannedSceneBreaks,
  countMissingSegmentMarkers,
  countSceneBreakLines,
  ensureLeadingMarker,
  findThinDialogueBeats,
  keepOnlyMarkers,
  planSceneBreaks,
  planSkeletonCalls,
  renderPlannedNarrative,
  restoreSceneBreaks,
  type PlannedBreakResult,
  type SceneBreakPlan,
  type SkeletonCall,
} from './sceneBreakPlan';
import {
  type DialoguePolishSummary,
  type RunSceneGenerationPipelineInput,
  type RunSceneGenerationPipelineResult,
  type SceneGenerationPipelineAiService,
  type SceneGenerationPipelineTaskProviders,
} from './sceneGenerationTypes';

interface PartialRewrites {
  rewrites: readonly SceneDialogueRewrite[];
  heldBack: number;
}

interface BeatActorRequest {
  readonly character: SceneBeatCharacter;
  readonly beat: SceneBeatDirective;
  readonly nextBeats: readonly SceneBeatDirective[];
}

interface ActorLineCaps {
  readonly lineMaxChars: number;
  readonly lineMaxSentences: number;
}

interface CastProposal {
  readonly name: string;
  readonly proposal: SceneBeatProposal | undefined;
}

interface BeatReview {
  readonly verdict: SceneBeatVerdict | undefined;
  readonly reasons: string[];
}

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
  const sceneStem: string = input.sceneStem ?? input.context.scene.stem;
  const body: string = context.scene.body.trim();
  const narrativeParts: SceneNarrativeParts = splitSceneNarrativeSource(
    renderNarrativeBodyWithCastNames(context) ?? body,
  );
  const tuning: ResolvedSceneGenerationTuning = resolveSceneGenerationTuning(input.tuning);
  const beats: SceneBeat[] = context.scene.card?.beats ?? [];
  const breakPlan: SceneBreakPlan | undefined = planSceneBreaks(beats, castNameOf(context), tuning.sceneBreakTimeJumpMinutes);

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

function skeletonTargetLength(
  styleDirective: StyleDirective | undefined,
  skeletonRatio: number,
): number | undefined {
  const target: number | undefined = styleDirective?.targetWordCount;
  return target === undefined ? undefined : Math.round(target * skeletonRatio);
}

function sectionTargetLengths(
  styleDirective: StyleDirective | undefined,
  sections: readonly string[],
  outputLimit: number,
): number[] {
  const target: number = styleDirective?.targetWordCount ?? outputLimit * sections.length;
  return planSectionTargetLengths(sections, target, outputLimit);
}

function castNameOf(context: SceneContext): (ref: string) => string {
  const nameById: Map<string, string> = new Map(context.characters.map((character) => [character.id, character.name]));
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

function buildSkeletonContext(
  previousContext: string | undefined,
  canonFactLines: readonly string[] | undefined,
): string | undefined {
  const sections: string[] = [
    canonFactLines && canonFactLines.length > 0
      ? `[설정 메모]\n${canonFactLines.map((line) => `- ${line}`).join('\n')}\n(작가 참고용 배경지식이다. 인물이 아직 모르는 사실을 대사·사건으로 드러내지 마라.)`
      : undefined,
    previousContext,
  ].filter((section): section is string => Boolean(section));

  return sections.length > 0 ? sections.join('\n\n') : undefined;
}

async function draftSkeletonWithRetries(
  aiService: Pick<SceneGenerationPipelineAiService, 'draftSceneSkeleton' | 'checkSceneCoverage'>,
  input: Parameters<SceneGenerationPipelineAiService['draftSceneSkeleton']>[0],
  options: GenerateTextOptions,
  retryLimit: number,
  tuning: ResolvedSceneGenerationTuning,
  breakPlan: SceneBreakPlan | undefined,
  beats: readonly SceneBeat[],
  coverageBeats: readonly string[],
  segmentNumbers?: readonly number[],
): Promise<SkeletonDraft> {
  let reasons: string[] = [];
  let best:
    | {
        text: string;
        violations: readonly SectionViolation[];
        missingBeats: readonly string[];
        weight: number;
        distance: number;
      }
    | undefined;
  let retries: number = 0;

  for (let attempt: number = 0; attempt <= retryLimit; attempt += 1) {
    retries = attempt;
    const rawResponse: string = await aiService.draftSceneSkeleton(
      { ...input, ...(reasons.length > 0 ? { retryReasons: reasons } : {}) },
      options,
    );
    const response: string = curlDialogueQuotes(rawResponse);
    const skeleton: string =
      segmentNumbers === undefined
        ? response
        : keepOnlyMarkers(
            segmentNumbers[0] === undefined
              ? response
              : ensureLeadingMarker(response, segmentNumbers[0]),
            segmentNumbers,
          );
    const missingBeats: string[] = await findMissingBeats(aiService, coverageBeats, skeleton, options);
    const violations: SectionViolation[] = [
      ...validateSceneSkeleton(skeleton, input.targetLength, tuning),
      ...validatePlannedSceneBreaks(skeleton, breakPlan, segmentNumbers),
      ...missingBeatsViolation(missingBeats),
    ];

    if (violations.length === 0) {
      return { text: skeleton, violations: [], missingBeats: [], retries };
    }

    const weight: number = weighViolations(violations, tuning.violationWeights);
    const distance: number =
      input.targetLength === undefined ? 0 : Math.abs(skeleton.length - input.targetLength);
    if (
      best === undefined ||
      weight < best.weight ||
      (weight === best.weight && distance < best.distance)
    ) {
      best = { text: skeleton, violations, missingBeats, weight, distance };
    }

    reasons = [
      ...violations.map((violation) => violation.detail),
      ...thinDialogueReasons(skeleton, violations, breakPlan, beats, tuning),
    ];
  }

  return {
    text: best?.text ?? '',
    violations: best?.violations ?? [],
    missingBeats: best?.missingBeats ?? [],
    retries,
  };
}

interface SkeletonDraft {
  readonly text: string;
  readonly violations: readonly SectionViolation[];
  readonly missingBeats: readonly string[];
  readonly retries: number;
}

function curlDialogueQuotes(text: string): string {
  return text.replace(/"([^"\n]+)"/g, '“$1”');
}

async function findMissingBeats(
  aiService: Pick<SceneGenerationPipelineAiService, 'checkSceneCoverage'>,
  beats: readonly string[],
  skeleton: string,
  options: GenerateTextOptions,
): Promise<string[]> {
  if (beats.length === 0) {
    return [];
  }

  const issues: SceneCoverageIssue[] = await aiService.checkSceneCoverage(beats, skeleton, options);
  return issues
    .filter((issue) => issue.status === 'missing')
    .map((issue) => beats[issue.index - 1])
    .filter((beat): beat is string => beat !== undefined);
}

function missingBeatsViolation(missing: readonly string[]): SectionViolation[] {
  if (missing.length === 0) {
    return [];
  }

  const listed: string = missing
    .slice(0, thinBeatListLimit)
    .map((text) => `«${shortBeat(text)}»`)
    .join('·');
  return [
    {
      kind: 'missing-beats',
      detail: `사건 ${listed}${missing.length > thinBeatListLimit ? ` 외 ${missing.length - thinBeatListLimit}개` : ''}이 뼈대에 없습니다. 사건 목록의 사건을 순서대로 빠짐없이 담으세요`,
    },
  ];
}

function skeletonWarningLabel(call: string, retries: number): string {
  return retries > 0 ? `${call} (재시도 ${retries}회 뒤 채택한 판)` : call;
}

function shortBeat(text: string): string {
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
}

const thinBeatListLimit: number = 6;

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

  const thin: string[] = findThinDialogueBeats(skeleton, breakPlan, beats, tuning.skeletonThinDialogueTurns);
  if (thin.length === 0) {
    return [];
  }

  const listed: string = thin
    .slice(0, thinBeatListLimit)
    .map((text) => `«${text}»`)
    .join('·');
  return [
    `사건 ${listed}${thin.length > thinBeatListLimit ? ` 외 ${thin.length - thinBeatListLimit}개` : ''}의 대화가 짧습니다. 이 사건들은 각각 ${tuning.skeletonRequestedDialogueTurns}턴 이상 밀고 당기게 늘리세요`,
  ];
}

function validatePlannedSceneBreaks(
  skeleton: string,
  breakPlan: SceneBreakPlan | undefined,
  segmentNumbers?: readonly number[],
): SectionViolation[] {
  if (breakPlan === undefined) {
    return [];
  }

  const missingMarkers: number = countMissingSegmentMarkers(
    skeleton,
    segmentNumbers ?? breakPlan.segments.map((_, index) => index + 1),
  );
  return missingMarkers === 0
    ? []
    : [
        {
          kind: 'scene-breaks',
          detail: `⟪대목 n⟫ 표식 ${missingMarkers}개가 빠져 그 대목이 앞 대목에 붙었습니다. 사건 목록의 ⟪대목⟫ 줄을 모두 그 자리에 옮겨 적으세요`,
        },
      ];
}

interface CheckedSectionText {
  readonly text: string;
  readonly violations: readonly SectionViolation[];
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
  readonly sectionPlaces: readonly string[];
  readonly characters: SceneContext['characters'];
  readonly options: GenerateTextOptions;
  readonly tuning: ResolvedSceneGenerationTuning;
}): Promise<CheckedSectionText> {
  let reasons: string[] = [];
  let isUnderLengthRetry: boolean = false;
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

  for (let attempt: number = 0; attempt <= input.tuning.sectionRetryLimit; attempt += 1) {
    const expanded: string = await input.aiService.expandSceneSection(
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

    const violations: SectionViolation[] = validateExpandedSection({
      skeleton: input.skeleton,
      section: input.section,
      expanded,
      characters: input.characters,
      targetLength: input.targetLength,
      ...(input.previousSection === undefined ? {} : { previousSection: input.previousSection }),
      sectionPlaces: input.sectionPlaces,
      backgroundFacts: input.backgroundFacts,
      tuning: input.tuning,
    });

    if (violations.length === 0) {
      return { text: expanded, violations: [] };
    }

    const weight: number = weighViolations(violations, input.tuning.violationWeights);
    const distance: number = Math.abs(expanded.length - input.targetLength);
    if (weight < best.weight || (weight === best.weight && distance < best.distance)) {
      best = { text: expanded, violations, weight, distance };
    }

    isUnderLengthRetry = violations.some((violation) => violation.kind === 'too-short');
    const thinSpots: string | undefined = isUnderLengthRetry
      ? describeThinExpansionSpots(
          findThinExpansionSpots(input.section, expanded, input.tuning.dialogueMinimumQuotedLength),
        )
      : undefined;
    reasons = [
      ...violations.map((violation) => violation.detail),
      ...(thinSpots === undefined ? [] : [thinSpots]),
    ];
  }

  return { text: best.text, violations: best.violations };
}

function weighViolations(
  violations: readonly SectionViolation[],
  weights: ResolvedSceneGenerationTuning['violationWeights'],
): number {
  return violations.reduce((total, violation) => total + weights[violation.kind], 0);
}

function otherVoices(
  characters: readonly CharacterCard[],
  name: string,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    characters.flatMap((character) => {
      const voice: string | undefined = character.voice?.[0]?.trim();
      return character.name === name || voice === undefined || voice.length === 0
        ? []
        : [[character.name, voice]];
    }),
  );
}

interface DialoguePolishOutcome {
  readonly text: string;
  readonly warnings: readonly string[];
  readonly summary: DialoguePolishSummary | undefined;
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
}): Promise<DialoguePolishOutcome> {
  const numbered: NumberedSkeleton = numberSkeletonDialogue(input.skeleton, input.tuning);
  const speakers: string[] = [...input.personas.keys()];

  if (numbered.dialogues.length === 0 || speakers.length === 0) {
    input.onProgress?.('polishDialogue', 1, 1);
    return { text: input.skeleton, warnings: [], summary: undefined };
  }

  const catchphrases: ReadonlyMap<string, readonly string[]> = characterCatchphrases(input.characters);
  const speechToOthers: ReadonlyMap<string, readonly string[]> = characterSpeechToOthers(input.characters);
  const validateAgainstSkeleton = (polished: string): SectionViolation[] =>
    validatePolishedSkeleton({
      skeleton: input.skeleton,
      polished,
      characters: input.characters,
      lengthLimit: input.skeleton.length * input.tuning.polishLengthLimitRatio,
      tuning: input.tuning,
    });

  const accepted: Map<string, readonly SceneDialogueRewrite[]> = new Map<string, readonly SceneDialogueRewrite[]>();
  const rejected: Map<string, readonly SectionViolation[]> = new Map<string, readonly SectionViolation[]>();
  const partial: Map<string, PartialRewrites> = new Map<string, PartialRewrites>();
  const truncated: Set<string> = new Set<string>();
  let pending: string[] = speakers;

  for (
    let attempt: number = 0;
    attempt < input.tuning.polishRetryLimit && pending.length > 0;
    attempt += 1
  ) {
    const failing: string[] = [];

    for (const [position, name] of pending.entries()) {
      input.onProgress?.('polishDialogue', position + 1, pending.length);
      const retryReasons: string[] | undefined = rejected.get(name)?.map((violation) => violation.detail);
      const response: SceneDialoguePolishResult = await input.aiService.polishSceneDialogue(
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

      const lines: Map<number, string> = new Map(
        response.rewrites.flatMap((rewrite) => {
          const text: string | undefined = claimableRewriteText(rewrite, numbered);
          return text === undefined ? [] : [[rewrite.index, text] as const];
        }),
      );
      const lineViolations: Map<number, SectionViolation[]> = findPolishedLineViolations({
        skeleton: input.skeleton,
        lines,
        characters: input.characters,
        tuning: input.tuning,
      });
      const kept: SceneDialogueRewrite[] = response.rewrites.filter((rewrite) => !lineViolations.has(rewrite.index));
      const solo: DialogueRewriteMerge = mergeDialogueRewrites(input.skeleton, numbered, new Map([[name, kept]]));
      const sceneViolations: SectionViolation[] = validateAgainstSkeleton(solo.text);
      const violations: SectionViolation[] = [...[...lineViolations.values()].flat(), ...sceneViolations];

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

  const warnings: string[] = [
    ...[...rejected.entries()].map(([name, violations]) => {
      const details: string = violations.map((violation) => violation.detail).join(' / ');
      const kept: PartialRewrites | undefined = partial.get(name);
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

  const merged: DialogueRewriteMerge = mergeDialogueRewrites(input.skeleton, numbered, accepted);
  const combinedViolations: SectionViolation[] = validateAgainstSkeleton(merged.text);

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

function characterSpeechToOthers(
  characters: SceneContext['characters'],
): ReadonlyMap<string, readonly string[]> {
  const nameById: Map<string, string> = new Map(characters.map((character) => [character.id, character.name]));
  const lines: Map<string, readonly string[]> = new Map<string, readonly string[]>();

  for (const character of characters) {
    const rules: string[] = (character.relations ?? []).flatMap((relation) => {
      const target: string | undefined = nameById.get(relation.target);
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

async function buildVoiceSamples(
  characters: readonly CharacterCard[],
  dialogueCorpus: RunSceneGenerationPipelineInput['dialogueCorpus'],
  sceneStem: string | undefined,
  tuning: ResolvedSceneGenerationTuning,
): Promise<Map<string, readonly string[]>> {
  const voiceSamples: Map<string, readonly string[]> = new Map<string, readonly string[]>();

  if (!dialogueCorpus) {
    return voiceSamples;
  }

  const corpus: readonly SceneDialogueRecord[] = await dialogueCorpus.loadCorpus();
  const seeds: Readonly<Record<string, readonly string[]>> = (await dialogueCorpus.loadVoiceSeeds?.())?.characters ?? {};
  const bounds: VoiceSampleBounds = {
    minimumLength: tuning.voiceSampleMinimumLength,
    maximumLength: tuning.voiceSampleMaximumLength,
  };

  for (const character of characters) {
    const fromDrafts: string[] = selectRepresentativeDialogue(
      corpus,
      character.id,
      sceneStem ?? '',
      tuning.voiceSampleLimit,
      bounds,
    );
    const fromNotes: string[] = (seeds[character.id] ?? []).filter(
      (line) =>
        line.length >= bounds.minimumLength &&
        line.length <= bounds.maximumLength &&
        !fromDrafts.includes(line),
    );
    const samples: string[] = [...fromDrafts, ...fromNotes].slice(0, tuning.voiceSampleLimit);
    if (samples.length > 0) {
      voiceSamples.set(character.name, samples);
    }
  }

  return voiceSamples;
}

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

  const lines: string[] = extractDialogueLines(input.draftBody, input.tuning);
  const candidates: CharacterRef[] = input.characters.map((character): CharacterRef => ({
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

  const speakerByIndex: Map<number, string> = new Map(speakers.map((entry) => [entry.index, entry.speaker]));
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

interface SceneRunState {
  readonly input: RunSceneGenerationPipelineInput;
  readonly executionContext: ResolvedExecutionContext;
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
    const { executionContext, input } = state;
    state.personasUsed = await buildScenePersonas(
      executionContext.context.characters,
      {
        ...buildGenerateOptions(executionContext.providers, 'personaGeneration'),
        styleDirective: executionContext.styleDirective,
      },
      executionContext.aiService,
      input.personaStore,
      executionContext.sceneRef,
      executionContext.onProgress,
      executionContext.shouldCancel,
    );
  },
};

const describeBackgroundStage: ISceneStage = {
  id: 'describeBackground',
  async run(state) {
    const { executionContext, input } = state;

    if (executionContext.context.background) {
      state.background = await describeBackgroundForScene(
        executionContext.context.background,
        executionContext.aiService,
        input.backgroundStore,
        input.backgroundRecentExcerpt,
      );
    }
    assertNotCancelled(executionContext.shouldCancel);
  },
};

const checkBackgroundFactsStage: ISceneStage = {
  id: 'checkBackgroundFacts',
  async run(state) {
    const { executionContext, input } = state;
    const card: BackgroundCard | undefined = executionContext.context.background;

    if (card) {
      state.backgroundFactConflicts = await findBackgroundFactConflictsForScene(
        card,
        executionContext.aiService,
        input.backgroundFactConflictStore,
      );
      state.warnings.push(
        ...state.backgroundFactConflicts.map(
          (conflict) =>
            `배경 «${card.name}»: ${formatBackgroundFactConflict(conflict)}는 함께 참일 수 없어 사건에 맞는 쪽만 씁니다.`,
        ),
      );
    }
    assertNotCancelled(executionContext.shouldCancel);
  },
};

const collectVoiceSamplesStage: ISceneStage = {
  id: 'collectVoiceSamples',
  async run(state) {
    const { executionContext, input } = state;
    state.voiceSamples = await buildVoiceSamples(
      executionContext.context.characters,
      input.dialogueCorpus,
      input.sceneStem,
      executionContext.tuning,
    );
  },
};

type SkeletonCallInput = Parameters<SceneGenerationPipelineAiService['draftSceneSkeleton']>[0];

interface CombinedSkeletonDraft {
  readonly text: string;
  readonly warnings: readonly string[];
}

async function draftSkeletonInCalls(input: {
  readonly executionContext: ResolvedExecutionContext;
  readonly base: SkeletonCallInput;
  readonly options: GenerateTextOptions;
  readonly calls: readonly SkeletonCall[];
  readonly plan: SceneBreakPlan;
  readonly beats: readonly SceneBeat[];
  readonly targetLength: number;
}): Promise<CombinedSkeletonDraft> {
  const { executionContext, base, options, calls, plan, beats, targetLength } = input;
  const castName: (ref: string) => string = castNameOf(executionContext.context);
  const totalBeats: number = calls.reduce((sum, call) => sum + call.beats.length, 0);
  const endState: string | undefined = executionContext.context.scene.card?.endState;
  const parts: string[] = [];
  const drafts: SkeletonDraft[] = [];

  for (const [index, call] of calls.entries()) {
    executionContext.onProgress?.('draftSkeleton', index + 1, calls.length);
    const next: SkeletonCall | undefined = calls[index + 1];
    const nextBeat: string | undefined = next === undefined ? undefined : beatText(beats[next.beats[0] ?? -1]);

    const skeletonDraft: SkeletonDraft = await draftSkeletonWithRetries(
      executionContext.aiService,
      {
        ...base,
        narrativeSource: renderPlannedNarrative(beats, plan, castName, call.beats),
        targetLength: Math.round((targetLength * call.beats.length) / totalBeats),
        ...(parts.length > 0 ? { priorSkeleton: parts.join('\n\n') } : {}),
        ...(nextBeat === undefined ? {} : { nextBeat }),
        ...(next === undefined && endState !== undefined ? { endState } : {}),
      },
      options,
      executionContext.tuning.skeletonRetryLimit,
      executionContext.tuning,
      plan,
      beats,
      call.beats.map((beat) => beatText(beats[beat]) ?? ''),
      call.markers,
    );
    parts.push(skeletonDraft.text);
    drafts.push(skeletonDraft);
    assertNotCancelled(executionContext.shouldCancel);
  }

  const text: string = parts.join('\n\n');
  const reported: string[] = drafts.flatMap((draft) => draft.missingBeats);
  const stillMissing: Set<string> = new Set(
    reported.length === 0 ? [] : await findMissingBeats(executionContext.aiService, reported, text, options),
  );
  const warnings: string[] = drafts.flatMap((draft, index) => {
    const label: string = skeletonWarningLabel(`뼈대 ${index + 1}/${calls.length}`, draft.retries);
    const kept: SectionViolation[] = [
      ...draft.violations.filter((violation) => violation.kind !== 'missing-beats'),
      ...missingBeatsViolation(draft.missingBeats.filter((beat) => stillMissing.has(beat))),
    ];
    return kept.map((violation) => `${label}: ${violation.detail}`);
  });

  return { text, warnings };
}

function beatText(beat: SceneBeat | undefined): string | undefined {
  return beat === undefined ? undefined : typeof beat === 'string' ? beat : beat.text;
}

const draftSkeletonStage: ISceneStage = {
  id: 'draftSkeleton',
  async run(state) {
    const { executionContext, input } = state;
    const beats: SceneBeat[] = executionContext.context.scene.card?.beats ?? [];
    const targetLength: number | undefined = skeletonTargetLength(executionContext.styleDirective, executionContext.tuning.skeletonRatio);
    const endState: string | undefined = executionContext.context.scene.card?.endState;
    const base: SkeletonCallInput = {
      narrativeSource: executionContext.narrativeSource,
      ...(executionContext.design.length > 0 ? { design: executionContext.design } : {}),
      personas: state.personasUsed,
      catchphrases: characterCatchphrases(executionContext.context.characters),
      characterKnowledge: input.characterKnowledge,
      background: state.background,
      backgroundConflicts: state.backgroundFactConflicts.map(formatBackgroundFactConflict),
      previousContext: buildSkeletonContext(executionContext.condensedPreviousContext, input.canonFactLines),
      grounding: executionContext.context.scene.frontmatter.grounding,
      ...(targetLength === undefined ? {} : { targetLength }),
      ...(executionContext.breakPlan === undefined ? {} : { plannedBreaks: true }),
    };
    const options: GenerateTextOptions = withAttribution(
      {
        ...buildGenerateOptions(executionContext.providers, 'sceneSkeleton'),
        styleDirective: executionContext.styleDirective,
      },
      { primary: executionContext.sceneRef },
    );
    const calls: SkeletonCall[] | undefined =
      executionContext.breakPlan === undefined
        ? undefined
        : planSkeletonCalls(executionContext.breakPlan, targetLength, executionContext.tuning.skeletonCharsPerCall);

    let skeleton: { readonly text: string; readonly warnings: readonly string[] };
    if (calls === undefined || calls.length === 1 || targetLength === undefined) {
      executionContext.onProgress?.('draftSkeleton', 1, 1);
      const whole: SkeletonDraft = await draftSkeletonWithRetries(
        executionContext.aiService,
        { ...base, ...(endState === undefined ? {} : { endState }) },
        options,
        executionContext.tuning.skeletonRetryLimit,
        executionContext.tuning,
        executionContext.breakPlan,
        beats,
        beats.map((beat) => beatText(beat) ?? ''),
      );
      skeleton = {
        text: whole.text,
        warnings: whole.violations.map(
          (violation) => `${skeletonWarningLabel('뼈대', whole.retries)}: ${violation.detail}`,
        ),
      };
    } else {
      skeleton = await draftSkeletonInCalls({
        executionContext,
        base,
        options,
        calls,
        plan: executionContext.breakPlan as SceneBreakPlan,
        beats,
        targetLength,
      });
    }
    state.warnings.push(...skeleton.warnings);
    adoptSkeleton(state, skeleton.text);
    assertNotCancelled(executionContext.shouldCancel);
  },
};

function adoptSkeleton(state: SceneRunState, skeletonText: string): void {
  const { executionContext } = state;
  const applied: PlannedBreakResult | undefined =
    executionContext.breakPlan === undefined
      ? undefined
      : applyPlannedSceneBreaks(skeletonText, executionContext.breakPlan);
  if (applied !== undefined && !applied.hasNoMarkers) {
    state.skeleton = applied.text;
    state.sceneCoordinates = {
      segments: applied.coordinates,
      isAlignedWithBreaks: true,
      beats: applied.beats,
    };
    state.polishedText = state.skeleton;
    return;
  }

  const extracted: ExtractedSceneCoordinates = extractSceneCoordinates(skeletonText);
  state.skeleton = extracted.text;
  const missingCoordinates: number = countMissingSceneCoordinates(extracted.ledger);
  if (hasSceneCoordinates(extracted.ledger) && missingCoordinates === 0) {
    state.sceneCoordinates = extracted.ledger;
  } else {
    state.sceneCoordinates = sceneCoordinatesFromBeats(
      executionContext.context.scene.card?.beats,
      castNameOf(executionContext.context),
    );
    if (hasSceneCoordinates(extracted.ledger)) {
      state.warnings.push(
        `뼈대: 장면 표식이 ${missingCoordinates}곳 빠져 비트의 좌표를 대신 씁니다.`,
      );
    }
  }
  state.polishedText = state.skeleton;
}

const actBeatsStage: ISceneStage = {
  id: 'actBeats',
  async run(state) {
    const { executionContext, input } = state;
    const sourceBeats: SceneBeat[] = executionContext.context.scene.card?.beats ?? [];
    const beats: ActedBeat[] = planActedBeats(sourceBeats, executionContext.context.characters);

    if (beats.length === 0) {
      state.warnings.push('배우 뼈대: 씬 카드에 비트가 없어 뼈대 단계로 대신 썼습니다.');
      await draftSkeletonStage.run(state);
      return;
    }

    const optionsFor = (task: keyof SceneGenerationPipelineTaskProviders): GenerateTextOptions =>
      withAttribution(
        { ...buildGenerateOptions(executionContext.providers, task), styleDirective: executionContext.styleDirective },
        { primary: executionContext.sceneRef },
      );
    const castName: (ref: string) => string = castNameOf(executionContext.context);
    const catchphrases: ReadonlyMap<string, readonly string[]> = characterCatchphrases(executionContext.context.characters);
    const speechToOthers: ReadonlyMap<string, readonly string[]> = characterSpeechToOthers(executionContext.context.characters);
    const notes: Map<string, readonly BeatNote[]> = new Map<string, readonly BeatNote[]>();
    const passages: Map<number, string> = new Map<number, string>();
    const focal: string | undefined = executionContext.styleDirective?.narration?.focal;

    const characterFor = (name: string, beat: ActedBeat): SceneBeatCharacter => ({
      name,
      persona: state.personasUsed.get(name) ?? '',
      catchphrases: catchphrases.get(name) ?? [],
      knowledge: input.characterKnowledge?.get(name) ?? [],
      speechToOthers: speechToOthers.get(name) ?? [],
      relationChanges: input.characterRelations?.get(name) ?? [],
      notes: liveBeatNotes(notes.get(name) ?? [], beat.number),
      witnessed: witnessedPassages(beats, passages, name),
    });

    const propose = async (
      name: string,
      beat: ActedBeat,
      directive: SceneBeatDirective,
      nextBeats: readonly SceneBeatDirective[],
    ): Promise<SceneBeatProposal | undefined> => {
      const request: BeatActorRequest = { character: characterFor(name, beat), beat: directive, nextBeats };
      const caps: ActorLineCaps = {
        lineMaxChars: executionContext.tuning.actorLineMaxChars,
        lineMaxSentences: executionContext.tuning.actorLineMaxSentences,
      };
      const first: SceneBeatProposal | undefined = await executionContext.aiService.proposeBeatAction(
        { ...request, ...caps },
        optionsFor('sceneBeatActor'),
      );
      const overlongLines: string[] =
        first === undefined
          ? []
          : findOverlongLines(first, caps.lineMaxChars, caps.lineMaxSentences);

      if (first !== undefined && overlongLines.length === 0) {
        return first;
      }

      const second: SceneBeatProposal | undefined = await executionContext.aiService.proposeBeatAction(
        { ...request, ...caps, overlongLines },
        optionsFor('sceneBeatActor'),
      );
      return second ?? first;
    };

    for (const [index, beat] of beats.entries()) {
      executionContext.onProgress?.('actBeats', index + 1, beats.length);
      const directive: SceneBeatDirective = toBeatDirective(beat, sourceBeats[index], castName);
      const nextBeats: SceneBeatDirective[] = nextActedBeats(beats, index).map((next) =>
        toBeatDirective(next, sourceBeats[next.number - 1], castName),
      );
      const isLast: boolean = index === beats.length - 1;

      const proposals: CastProposal[] = await Promise.all(
        beat.cast.map(async (name): Promise<CastProposal> => ({
          name,
          proposal: await propose(name, beat, directive, nextBeats),
        })),
      );
      const arbitrate = (retryReasons?: readonly string[]): Promise<SceneBeatPassage> =>
        executionContext.aiService.arbitrateBeat(
          {
            beat: directive,
            nextBeats,
            proposals,
            priorPassages: priorPassages(beats, passages),
            grounding: executionContext.context.scene.frontmatter.grounding,
            ...(executionContext.design.length > 0 ? { design: executionContext.design } : {}),
            previousContext: buildSkeletonContext(
              executionContext.condensedPreviousContext,
              input.canonFactLines,
            ),
            ...(focal !== undefined && beat.cast.includes(focal) ? { innerCharacter: focal } : {}),
            catchphraseLimit: executionContext.tuning.catchphrasePerBeatLimit,
            ...(isLast ? { endState: executionContext.context.scene.card?.endState } : {}),
            ...(retryReasons === undefined ? {} : { retryReasons }),
          },
          optionsFor('sceneBeatArbiter'),
        );
      const judge = (passage: string): Promise<SceneBeatVerdict | undefined> =>
        executionContext.aiService.judgeBeat(
          {
            characters: beat.cast.map((name) => characterFor(name, beat)),
            beat: directive,
            nextBeats,
            previousPassages: previousPassagesForJudge(beats, passages, beat.number),
            passage,
          },
          optionsFor('sceneBeatJudge'),
        );
      const review = async (passage: string): Promise<BeatReview> => {
        const verdict: SceneBeatVerdict | undefined = await judge(passage);
        return {
          verdict,
          reasons: beatRetryReasons({
            verdict,
            catchphraseOveruse: findBeatCatchphraseOveruse({
              beat,
              passage,
              catchphrases,
              limit: executionContext.tuning.catchphrasePerBeatLimit,
            }),
          }),
        };
      };

      let merged: SceneBeatPassage = await arbitrate();
      let reviewed: BeatReview = await review(merged.passage);

      for (
        let attempt: number = 0;
        attempt < executionContext.tuning.actorRetryLimit && reviewed.reasons.length > 0;
        attempt += 1
      ) {
        merged = await arbitrate(reviewed.reasons);
        reviewed = await review(merged.passage);
      }

      if (reviewed.reasons.length > 0) {
        state.warnings.push(`배우 뼈대 ${beat.number}번 대목: ${reviewed.reasons.join(' / ')}`);
      }
      for (const score of reviewed.verdict?.scores ?? []) {
        if (shouldNoteScore(score.score) && beat.cast.includes(score.name)) {
          notes.set(score.name, addBeatNote(notes.get(score.name) ?? [], beat.number, score.avoid));
        }
      }

      passages.set(beat.number, merged.passage);
      assertNotCancelled(executionContext.shouldCancel);
    }

    adoptSkeleton(state, assembleActedSkeleton(beats, passages));
  },
};

const polishDialogueStage: ISceneStage = {
  id: 'polishDialogue',
  async run(state) {
    const { executionContext } = state;
    const polished: DialoguePolishOutcome = await polishDialogueOrKeepSkeleton({
      aiService: executionContext.aiService,
      skeleton: state.skeleton,
      personas: state.personasUsed,
      voiceSamples: state.voiceSamples,
      characterKnowledge: state.input.characterKnowledge,
      characterRelations: state.input.characterRelations,
      characters: executionContext.context.characters,
      onProgress: executionContext.onProgress,
      options: withAttribution(
        {
          ...buildGenerateOptions(executionContext.providers, 'sceneDialoguePolish'),
          styleDirective: executionContext.styleDirective,
        },
        { primary: executionContext.sceneRef },
      ),
      tuning: executionContext.tuning,
    });
    state.polishedText = polished.text;
    state.dialoguePolish = polished.summary;
    state.warnings.push(...polished.warnings);
    assertNotCancelled(executionContext.shouldCancel);
  },
};

function backgroundFactLines(background: Background): string[] {
  const header: string = [background.time, background.weather]
    .filter((part): part is string => Boolean(part && part.trim().length > 0))
    .join(', ');

  return [
    ...(header.length > 0 ? [header] : []),
    ...(background.description ?? []),
    ...(background.senses ?? []),
  ].filter((line) => line.trim().length > 0);
}

function trimRunAhead(
  skeleton: string,
  section: string,
  outcome: { readonly text: string; readonly violations: readonly SectionViolation[] },
  tuning: ResolvedSceneGenerationTuning,
): CheckedSectionText {
  if (!outcome.violations.some((violation) => violation.kind === 'runs-ahead')) {
    return outcome;
  }

  const lines: string[] = findRunAheadDialogue(skeleton, section, outcome.text, tuning);
  const trimmed: string = trimRunAheadDialogue(outcome.text, lines);
  if (trimmed === outcome.text) {
    return outcome;
  }

  return {
    text: trimmed,
    violations: [
      ...outcome.violations.filter((violation) => violation.kind !== 'runs-ahead'),
      {
        kind: 'runs-ahead',
        detail: `다음 구간의 대사를 앞당겨 쓴 끝부분 ${(outcome.text.length - trimmed.length).toLocaleString()}자를 잘라 냈습니다`,
      },
    ],
  };
}

function restoreSectionBreaks(
  section: string,
  outcome: { readonly text: string; readonly violations: readonly SectionViolation[] },
): CheckedSectionText {
  if (!outcome.violations.some((violation) => violation.kind === 'scene-breaks')) {
    return outcome;
  }

  const restored: string | undefined = restoreSceneBreaks(section, outcome.text);
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

const expandSectionStage: ISceneStage = {
  id: 'expandSection',
  async run(state) {
    const { executionContext, input } = state;
    const outputLimit: number = input.sectionOutputLimit ?? SECTION_OUTPUT_LIMIT;
    const sections: string[] = splitSkeletonIntoSections(
      state.polishedText,
      planSectionCount(executionContext.styleDirective?.targetWordCount ?? 0, outputLimit),
    );
    const targetLengths: number[] = sectionTargetLengths(executionContext.styleDirective, sections, outputLimit);
    const beats: SceneBeat[] = executionContext.context.scene.card?.beats ?? [];
    const coordinatesBySection: string[][] = sectionSceneCoordinates(
      state.sceneCoordinates,
      sections,
      beats,
      castNameOf(executionContext.context),
    );
    const placesBySection: string[][] = sectionPlaces(state.sceneCoordinates, sections, beats);
    const scenePlaces: string[] = beats.flatMap((beat) =>
      typeof beat === 'string' || beat.place === undefined ? [] : [beat.place],
    );
    const backgroundFacts: string[] = backgroundFactLines(state.background);
    const expandedSections: string[] = [];

    for (let index: number = 0; index < sections.length; index += 1) {
      executionContext.onProgress?.('expandSection', index + 1, sections.length);

      const outcome: CheckedSectionText = await expandSectionWithRetries({
        aiService: executionContext.aiService,
        section: sections[index] as string,
        skeleton: state.polishedText,
        previousSection: expandedSections.at(-1),
        targetLength: targetLengths[index] as number,
        backgroundFacts: scopeBackgroundFacts(
          backgroundFacts,
          placesBySection[index] ?? [],
          scenePlaces,
        ),
        backgroundConflicts: state.backgroundFactConflicts.map(formatBackgroundFactConflict),
        sceneCoordinates: coordinatesBySection[index] ?? [],
        sectionPlaces: placesBySection[index] ?? [],
        characters: executionContext.context.characters,
        options: withAttribution(
          {
            ...buildGenerateOptions(executionContext.providers, 'sceneSectionExpansion'),
            styleDirective: executionContext.styleDirective,
          },
          { primary: executionContext.sceneRef },
        ),
        tuning: executionContext.tuning,
      });

      const repaired: CheckedSectionText = restoreSectionBreaks(
        sections[index] as string,
        trimRunAhead(state.polishedText, sections[index] as string, outcome, executionContext.tuning),
      );
      expandedSections.push(repaired.text);
      state.warnings.push(
        ...repaired.violations.map((violation) => `${index + 1}구간: ${violation.detail}`),
      );
      const recaps: number = countRecapPhrases(repaired.text);
      if (recaps > executionContext.tuning.sectionRecapPhraseLimit) {
        state.warnings.push(
          `${index + 1}구간: 앞 장면을 «아까 …»로 되짚는 표현이 ${recaps}회입니다 (허용 ${executionContext.tuning.sectionRecapPhraseLimit}회). 새 반응·논평·대사로 채우는 쪽이 낫습니다`,
        );
      }
      assertNotCancelled(executionContext.shouldCancel);
    }

    state.draftBody = expandedSections.join('\n\n');
    state.warnings.push(
      ...findCatchphraseOveruse({
        text: state.draftBody,
        characters: executionContext.context.characters,
        beatCount: executionContext.context.scene.card?.beats?.length ?? 0,
        tuning: executionContext.tuning,
      }),
    );
  },
};

const attributeDialogueStage: ISceneStage = {
  id: 'attributeDialogue',
  async run(state) {
    const { executionContext, input } = state;
    state.dialogueRecord = await buildDialogueRecord({
      aiService: executionContext.aiService,
      draftBody: state.draftBody,
      characters: executionContext.context.characters,
      sceneStem: input.sceneStem,
      options: withAttribution(buildGenerateOptions(executionContext.providers, 'sceneDialogueAttribution'), {
        primary: executionContext.sceneRef,
      }),
      onProgress: executionContext.onProgress,
      tuning: executionContext.tuning,
    });
  },
};

export const sceneStages: Readonly<Record<SceneStageId, ISceneStage>> = {
  buildPersonas: buildPersonasStage,
  describeBackground: describeBackgroundStage,
  checkBackgroundFacts: checkBackgroundFactsStage,
  collectVoiceSamples: collectVoiceSamplesStage,
  draftSkeleton: draftSkeletonStage,
  actBeats: actBeatsStage,
  polishDialogue: polishDialogueStage,
  expandSection: expandSectionStage,
  attributeDialogue: attributeDialogueStage,
};

async function executeSceneGenerationPipeline(
  input: RunSceneGenerationPipelineInput,
): Promise<RunSceneGenerationPipelineResult> {
  const executionContext: ResolvedExecutionContext = resolveExecutionContext(input);
  const plan: readonly SceneStageId[] = input.stages ?? resolveScenePipelinePlan();
  const state: SceneRunState = {
    input,
    executionContext,
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
    detectedCharacters: executionContext.detectedCharacters,
    personasUsed: state.personasUsed,
    providers: executionContext.providers,
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
