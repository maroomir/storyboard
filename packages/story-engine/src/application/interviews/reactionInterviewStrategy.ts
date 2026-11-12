import type { PlannedCardChanges } from '#engine/persistence/bundles/workspaceCards';
import type {
  InterviewAnswerRequest,
  InterviewConfirmRequest,
  InterviewOpenSession,
  InterviewOpenSessionStep,
  InterviewResumeRequest,
  InterviewSessionRequest,
  InterviewStartRequest,
  InterviewStartResult,
  IQuestionStrategy,
} from '#engine/application/interviews/questionStrategy';
import type {
  AiServices,
  HostAdapters,
  WorkspaceRepositories,
} from '#engine/application/engineServices';
import {
  chooseUpcomingScenes,
  collectBeatSituations,
  describeBeatSituation,
  isAxisDecided,
  listOpenAxes,
  unseenValueIds,
  type BeatSituationOptions,
} from '#engine/application/interviews/interviewCoverage';
import {
  collectAbsentPartnerTerms,
  describeBeatActor,
  describePresence,
  isOptionAddressingAbsentPartner,
  type InterviewPartner,
} from '#engine/application/interviews/interviewPresence';
import {
  resolveInterviewTuning,
  type InterviewTuning,
} from '#engine/application/interviews/interviewTuning';
import { failedResult } from '#engine/application/useCase';
import { SceneNarrationResolver } from '#engine/application/drafts/sceneNarrationResolver';
import type {
  InterviewClassificationDraft,
  InterviewDistillDraft,
  InterviewQuestionActor,
  InterviewQuestionAxis,
  InterviewQuestionDraft,
  InterviewQuestionInput,
  InterviewRelationSpeechQuestion,
  InterviewUpdateDraft,
  StoryboardAiService,
} from '@storyboard/story-ai';
import {
  applyCardCollectProposals,
  cardCollectProposalId,
  computeBackgroundCardHash,
  computeInterviewContractHash,
  computePersonaCardHash,
  getStoryboardProjectPaths,
  scenePath,
  serializeCard,
  shouldProposeCardCollect,
  deriveSceneGrounding,
  type BibleSubjectKind,
  type CardCollectProposal,
  type CardCollectProposalDraft,
  type CharacterRelation,
  type InterviewAnswer,
  type InterviewAnswerInput,
  type InterviewAnswerOutcome,
  type InterviewAxesFile,
  type InterviewAxis,
  relationSpeechAxisId,
  type InterviewAxisSet,
  type InterviewBeatSituation,
  type InterviewCardCoverage,
  type InterviewClassification,
  type InterviewConfirmation,
  type InterviewOpening,
  type InterviewOption,
  type InterviewQuestion,
  type InterviewRecord,
  type InterviewSessionSummary,
  type InterviewTallies,
  type InterviewWorkingModel,
  NarrationError,
  type NarrationDirective,
  type OutlineSynopsis,
  type SceneFile,
  type SceneListItem,
  type StoryboardCard,
  type StoryboardProject,
  type StoryboardProjectPaths,
  type StoryUri,
  type UsageAttribution,
} from '@storyboard/story-model';

export type {
  InterviewAnswerRequest,
  InterviewConfirmRequest,
  InterviewOpenSession,
  InterviewOpenSessionStep,
  InterviewResumeRequest,
  InterviewSessionRequest,
  InterviewStartRequest,
  InterviewStartResult,
} from '#engine/application/interviews/questionStrategy';

interface BeatToAsk {
  readonly situation: InterviewBeatSituation;
  readonly axes: readonly InterviewAxis[];
}

export interface InterviewContext {
  readonly workspaceRoot: StoryUri;
  readonly card: StoryboardCard;
  readonly cardType: BibleSubjectKind;
  readonly situationOptions: BeatSituationOptions;
  readonly project: StoryboardProject;
  readonly scenes: readonly SceneFile[];
  readonly axes: readonly InterviewAxis[];
  readonly model: InterviewWorkingModel;
  readonly tuning: InterviewTuning;
  readonly ai: StoryboardAiService;
  readonly attribution: UsageAttribution;
  readonly relationTargetNames: ReadonlyMap<string, string>;
  readonly characters: readonly StoryboardCard[];
}

const emptyTallies: InterviewTallies = {};

const sessionIdTimestampDigits: number = 17;

function closeSessionRecords(model: InterviewWorkingModel, sessionId: string): InterviewWorkingModel {
  return {
    ...model,
    records: model.records.flatMap((record): InterviewRecord[] => {
      if (record.sessionId !== sessionId) {
        return [record];
      }

      return record.answer === undefined ? [] : [{ ...record, isConfirmed: true }];
    }),
  };
}

function isAwaitingConfirmation(record: InterviewRecord): boolean {
  return record.answer?.kind === 'written' && !record.isConfirmed;
}

function countSessionAnswers(model: InterviewWorkingModel, sessionId: string): number {
  return model.records.filter(
    (record) => record.sessionId === sessionId && record.answer !== undefined && record.answer.kind !== 'skipped',
  ).length;
}

function cardTypeOf(card: StoryboardCard): BibleSubjectKind {
  return card.type === 'character' ? 'character' : 'background';
}

function cardHashOf(card: StoryboardCard): string {
  return card.type === 'character'
    ? computePersonaCardHash(card, 'interview')
    : computeBackgroundCardHash(card);
}

function addTally(
  tallies: InterviewTallies,
  axisId: string,
  valueId: string,
  weight: number,
): InterviewTallies {
  const axisTallies: Readonly<Record<string, number>> = tallies[axisId] ?? {};

  return {
    ...tallies,
    [axisId]: { ...axisTallies, [valueId]: Math.max(0, (axisTallies[valueId] ?? 0) + weight) },
  };
}

function withValue(
  axes: readonly InterviewAxis[],
  axisId: string,
  value: { readonly id: string; readonly label: string },
): InterviewAxis[] {
  return axes.map((axis) =>
    axis.id !== axisId || axis.values.some((existing) => existing.id === value.id)
      ? axis
      : { ...axis, values: [...axis.values, value] },
  );
}

function describeRecordChoice(record: InterviewRecord, axes: readonly InterviewAxis[]): string | undefined {
  const axis: InterviewAxis | undefined = axes.find((candidate) => candidate.id === record.axisId);
  const answer: InterviewAnswer | undefined = record.answer;

  if (answer === undefined || answer.kind === 'skipped' || axis === undefined) {
    return undefined;
  }

  const valueId: string =
    answer.kind === 'chosen' ? (record.options[answer.index]?.valueId ?? '') : answer.valueId;
  const label: string = axis.values.find((value) => value.id === valueId)?.label ?? valueId;

  return `${record.situation} → ${axis.label}: ${label}`;
}

function writtenAnswers(records: readonly InterviewRecord[], axes: readonly InterviewAxis[]): string[] {
  return records.flatMap((record): string[] => {
    const answer: InterviewAnswer | undefined = record.answer;
    const axis: InterviewAxis | undefined = axes.find((candidate) => candidate.id === record.axisId);
    return answer?.kind === 'written' && axis !== undefined
      ? [`${record.situation} → ${axis.label}: ${answer.text}`]
      : [];
  });
}

function describeSceneKind(scene: SceneFile): string {
  const parts: string[] = [
    scene.card.title ?? scene.stem,
    deriveSceneGrounding(scene, undefined).incident ?? scene.card.purpose,
  ].filter((part): part is string => part !== undefined && part.trim().length > 0);

  return parts.join(' — ');
}

function isRelationRecord(record: InterviewRecord): boolean {
  return record.source.kind === 'relation';
}

function collectAnsweredRelationSpeech(model: InterviewWorkingModel): Map<string, string> {
  const latestByTarget: Map<string, string> = new Map<string, string>();

  for (const record of model.records) {
    const answer: InterviewAnswer | undefined = record.answer;
    if (record.source.kind !== 'relation' || answer === undefined || answer.kind === 'skipped') {
      continue;
    }
    const speech: string | undefined =
      answer.kind === 'written' ? answer.text : record.options[answer.index]?.text;
    if (speech !== undefined) {
      latestByTarget.set(record.source.target, speech);
    }
  }

  return latestByTarget;
}

function collectRelationSpeechByTarget(context: InterviewContext): Map<string, string> {
  const speechByTarget: Map<string, string> = new Map<string, string>();
  if (context.card.type !== 'character') {
    return speechByTarget;
  }

  for (const relation of context.card.relations ?? []) {
    const speech: string = relation.speech?.trim() ?? '';
    if (speech.length > 0) {
      speechByTarget.set(relation.target, speech);
    }
  }
  for (const [target, speech] of collectAnsweredRelationSpeech(context.model)) {
    speechByTarget.set(target, speech);
  }

  return speechByTarget;
}

function describeRelationSpeech(context: InterviewContext): string[] {
  return [...collectRelationSpeechByTarget(context)].map(
    ([target, speech]): string =>
      `${context.card.name} → ${context.relationTargetNames.get(target) ?? target}: ${speech}`,
  );
}

const minimumQuestionOptions: number = 2;

function hasOptionAddressingAbsentPartner(
  draft: InterviewQuestionDraft,
  absentTerms: readonly string[],
): boolean {
  return draft.options.some((option) => isOptionAddressingAbsentPartner(option.text, absentTerms));
}

function listInterviewPartners(context: InterviewContext): InterviewPartner[] {
  const speechByTarget: Map<string, string> = collectRelationSpeechByTarget(context);
  const relations: readonly CharacterRelation[] =
    context.card.type === 'character' ? (context.card.relations ?? []) : [];

  return relations.flatMap((relation): InterviewPartner[] => {
    const partner: StoryboardCard | undefined = context.characters.find((card) => card.id === relation.target);
    return partner === undefined ? [] : [{ card: partner, speech: speechByTarget.get(relation.target) }];
  });
}

function describeRecordAnswer(record: InterviewRecord, axes: readonly InterviewAxis[]): string | undefined {
  const axis: InterviewAxis | undefined = axes.find((candidate) => candidate.id === record.axisId);
  const answer: InterviewAnswer | undefined = record.answer;

  if (answer === undefined || answer.kind === 'skipped' || axis === undefined) {
    return undefined;
  }

  const valueId: string =
    answer.kind === 'chosen' ? (record.options[answer.index]?.valueId ?? '') : answer.valueId;
  const label: string = axis.values.find((value) => value.id === valueId)?.label ?? valueId;
  const text: string =
    answer.kind === 'chosen' ? (record.options[answer.index]?.text ?? '') : answer.text;

  return `${record.situation} → ${axis.label}: ${label} — ${text}`;
}

export abstract class ReactionInterviewStrategy implements IQuestionStrategy {
  protected abstract readonly cardKind: BibleSubjectKind;

  public constructor(
    protected readonly host: HostAdapters,
    protected readonly aiServices: AiServices,
    protected readonly repositories: WorkspaceRepositories,
    private readonly now: () => Date = (): Date => new Date(),
  ) {}

  protected async askPreludeQuestion(
    _request: InterviewSessionRequest,
    _context: InterviewContext,
  ): Promise<InterviewQuestion | undefined> {
    return undefined;
  }

  protected async situationOptionsFor(
    _workspaceRoot: StoryUri,
    _card: StoryboardCard,
  ): Promise<BeatSituationOptions> {
    return {};
  }

  protected abstract proposalDraftsFrom(distilled: InterviewDistillDraft): CardCollectProposalDraft[];

  public async start(request: InterviewStartRequest): Promise<InterviewStartResult> {
    try {
      const card: StoryboardCard | undefined = await this.resolveCard(request);
      if (card === undefined) {
        return {
          ok: false,
          kind: 'card-not-found',
          message: `카드 ${request.cardId} 를 찾을 수 없습니다.`,
        };
      }

      if (request.shouldResetAxes === true) {
        await this.repositories.interviews.saveAxes(request.workspaceRoot, { version: 1 });
        await this.repositories.interviews.deleteWorkingModels(request.workspaceRoot);
      }

      const sessionId: string = this.now().toISOString().replace(/[-:.TZ]/g, '').slice(0, sessionIdTimestampDigits);
      const context: InterviewContext = await this.forgetUnansweredQuestions(
        request.workspaceRoot,
        await this.loadContext(request.workspaceRoot, card, request.sceneStems, sessionId),
      );

      return { ok: true, opening: await this.describeOpening(request.workspaceRoot, sessionId, context) };
    } catch (error) {
      this.host.logger.error('Interview start failed', error);
      return failedResult(error);
    }
  }

  public async findOpenSession(request: InterviewResumeRequest): Promise<InterviewOpenSession | undefined> {
    const card: StoryboardCard | undefined = await this.resolveCard(request);
    const latest: InterviewRecord | undefined =
      card === undefined ? undefined : (await this.loadSavedModel(request.workspaceRoot, card.id))?.records.at(-1);
    const isOpen: boolean = latest !== undefined && (latest.answer === undefined || isAwaitingConfirmation(latest));
    if (card === undefined || latest === undefined || !isOpen) {
      return undefined;
    }

    const context: InterviewContext = await this.loadContext(
      request.workspaceRoot,
      card,
      request.sceneStems,
      latest.sessionId,
    );

    return {
      opening: await this.describeOpening(request.workspaceRoot, latest.sessionId, context),
      question: this.toQuestion(latest, context.axes),
      step: this.describeOpenStep(latest, context.axes),
      answeredCount: countSessionAnswers(context.model, latest.sessionId),
    };
  }

  public async abandon(request: InterviewSessionRequest): Promise<void> {
    const card: StoryboardCard | undefined = await this.resolveCard(request);
    const model: InterviewWorkingModel | undefined =
      card === undefined ? undefined : await this.loadSavedModel(request.workspaceRoot, card.id);
    if (model === undefined) {
      return;
    }

    await this.saveModel(request.workspaceRoot, closeSessionRecords(model, request.sessionId));
  }

  private loadSavedModel(workspaceRoot: StoryUri, cardId: string): Promise<InterviewWorkingModel | undefined> {
    return this.repositories.interviews.loadWorkingModel(workspaceRoot, cardId);
  }

  private describeOpenStep(record: InterviewRecord, axes: readonly InterviewAxis[]): InterviewOpenSessionStep {
    const answer: InterviewAnswer | undefined = record.answer;
    if (answer === undefined || answer.kind !== 'written') {
      return { kind: 'answer' };
    }

    const axis: InterviewAxis | undefined = axes.find((candidate) => candidate.id === record.axisId);
    const label: string = axis?.values.find((value) => value.id === answer.valueId)?.label ?? answer.valueId;

    return {
      kind: 'confirm',
      classification: { valueId: answer.valueId, valueLabel: label, isNewValue: answer.isNewValue },
    };
  }

  private async describeOpening(
    workspaceRoot: StoryUri,
    sessionId: string,
    context: InterviewContext,
  ): Promise<InterviewOpening> {
    return {
      sessionId,
      cardId: context.card.id,
      cardType: context.cardType,
      name: context.card.name,
      coverage: this.describeCoverage(context),
      isContractStale: await this.isContractStale(workspaceRoot, context),
      maxQuestions: context.tuning.maxQuestionsPerSession,
    };
  }

  private async forgetUnansweredQuestions(
    workspaceRoot: StoryUri,
    context: InterviewContext,
  ): Promise<InterviewContext> {
    const answeredRecords: InterviewRecord[] = context.model.records.filter(
      (record) => record.answer !== undefined,
    );
    if (answeredRecords.length === context.model.records.length) {
      return context;
    }

    const model: InterviewWorkingModel = { ...context.model, records: answeredRecords };
    await this.saveModel(workspaceRoot, model);

    return { ...context, model };
  }

  public async next(request: InterviewSessionRequest): Promise<InterviewQuestion | undefined> {
    const context: InterviewContext = await this.requireContext(request);
    const { model, tuning } = context;
    const sessionRecords: readonly InterviewRecord[] = model.records.filter(
      (record) => record.sessionId === request.sessionId,
    );
    const pending: InterviewRecord | undefined = sessionRecords.find(
      (record) => record.answer === undefined,
    );
    if (pending !== undefined) {
      return this.toQuestion(pending, context.axes);
    }
    if (sessionRecords.length >= tuning.maxQuestionsPerSession) {
      return undefined;
    }

    const prelude: InterviewQuestion | undefined = await this.askPreludeQuestion(request, context);
    if (prelude !== undefined) {
      return prelude;
    }

    const openAxes: readonly InterviewAxis[] = context.axes.filter(
      (axis) => !isAxisDecided(model.tallies, axis.id, tuning.distillMinimumWeight),
    );
    const nextBeat: BeatToAsk | undefined = this.pickNextBeat(context, openAxes);
    const offBeatCount: number = sessionRecords.filter(
      (record) => record.source.kind === 'offBeat',
    ).length;
    const canAskOffBeat: boolean = offBeatCount < tuning.offBeatQuestionsPerSession;
    if (openAxes.length === 0 || (nextBeat === undefined && !canAskOffBeat)) {
      return undefined;
    }

    const draft: InterviewQuestionDraft | undefined = await this.draftQuestion(
      context,
      nextBeat === undefined ? openAxes : nextBeat.axes,
      nextBeat?.situation,
    );
    if (draft === undefined) {
      this.host.logger.warn('인터뷰 질문을 만들지 못해 이 세션을 여기서 닫습니다.');
      return undefined;
    }

    const record: InterviewRecord = this.toRecord(request.sessionId, context, draft, nextBeat?.situation);
    await this.saveModel(request.workspaceRoot, {
      ...model,
      records: [...model.records, record],
    });

    return this.toQuestion(record, context.axes);
  }

  private pickNextBeat(
    context: InterviewContext,
    openAxes: readonly InterviewAxis[],
  ): BeatToAsk | undefined {
    const askedPairs: Set<string> = new Set(
      context.model.records.flatMap((record) =>
        record.source.kind === 'beat'
          ? [`${record.source.sceneStem}#${record.source.beatIndex}#${record.axisId}`]
          : [],
      ),
    );

    const askedPerBeat: Map<string, number> = new Map<string, number>();
    for (const pair of askedPairs) {
      const beatKey: string = pair.slice(0, pair.lastIndexOf('#'));
      askedPerBeat.set(beatKey, (askedPerBeat.get(beatKey) ?? 0) + 1);
    }

    let leastAsked: BeatToAsk | undefined;
    let leastAskedCount: number = Number.POSITIVE_INFINITY;
    for (const situation of collectBeatSituations(context.card, context.scenes, context.situationOptions)) {
      const beatKey: string = `${situation.sceneStem}#${situation.beatIndex}`;
      const axes: InterviewAxis[] = openAxes.filter((axis) => !askedPairs.has(`${beatKey}#${axis.id}`));
      const askedCount: number = askedPerBeat.get(beatKey) ?? 0;
      if (axes.length > 0 && askedCount < leastAskedCount) {
        leastAsked = { situation, axes };
        leastAskedCount = askedCount;
      }
    }

    return leastAsked;
  }

  protected pickRelationTarget(context: InterviewContext): string | undefined {
    if (context.card.type !== 'character') {
      return undefined;
    }

    const asked: Set<string> = new Set(
      context.model.records.flatMap((record) =>
        record.source.kind === 'relation' ? [record.source.target] : [],
      ),
    );
    const present: Set<string> = new Set(
      context.scenes.flatMap((scene) => [
        ...(scene.card.characters ?? []),
        ...(scene.card.beats ?? []).flatMap((beat) => (typeof beat === 'string' ? [] : (beat.cast ?? []))),
      ]),
    );

    return (context.card.relations ?? [])
      .map((relation) => relation.target)
      .find((target) => !asked.has(target) && present.has(target));
  }

  protected async askRelationSpeech(
    request: InterviewSessionRequest,
    context: InterviewContext,
    target: string,
  ): Promise<InterviewQuestion | undefined> {
    const targetCard: StoryboardCard | undefined = await this.repositories.noteAbsorb.loadCard(
      request.workspaceRoot,
      'character',
      target,
    );
    const currentSpeech: string | undefined =
      context.card.type === 'character'
        ? (context.card.relations ?? []).find((relation) => relation.target === target)?.speech
        : undefined;
    const draft: InterviewRelationSpeechQuestion | undefined = await context.ai.askRelationSpeech(
      {
        name: context.card.name,
        catchphrases: context.card.type === 'character' ? (context.card.catchphrases ?? []) : [],
        targetId: target,
        targetName: targetCard?.name ?? target,
        targetAliases: targetCard?.aliases ?? [],
        ...(currentSpeech === undefined ? {} : { currentSpeech }),
        scenes: context.scenes.map(describeSceneKind),
        optionCount: context.tuning.optionCount,
      },
      { attribution: context.attribution },
    );
    if (draft === undefined) {
      this.host.logger.warn(`${targetCard?.name ?? target}에 대한 호칭 질문을 만들지 못해 건너뜁니다.`);
      return undefined;
    }

    const record: InterviewRecord = {
      id: `${request.sessionId}-${context.model.records.length + 1}`,
      sessionId: request.sessionId,
      askedAt: this.now().toISOString(),
      source: { kind: 'relation', target },
      axisId: relationSpeechAxisId,
      situation: `${targetCard?.name ?? target}에게`,
      question: draft.question,
      options: draft.options.map((text, index) => ({
        valueId: `speech-${index + 1}`,
        text,
        isExploration: false,
      })),
      isConfirmed: false,
    };
    await this.saveModel(request.workspaceRoot, {
      ...context.model,
      records: [...context.model.records, record],
    });

    return this.toQuestion(record, context.axes);
  }

  private async draftQuestion(
    context: InterviewContext,
    openAxes: readonly InterviewAxis[],
    nextBeat: InterviewBeatSituation | undefined,
  ): Promise<InterviewQuestionDraft | undefined> {
    const input: InterviewQuestionInput = this.buildQuestionInput(
      context,
      openAxes,
      nextBeat,
      await this.describeActor(context, nextBeat),
    );
    const absentTerms: string[] =
      nextBeat === undefined
        ? []
        : collectAbsentPartnerTerms({
            subject: context.card,
            situation: nextBeat,
            partners: listInterviewPartners(context),
          });
    const draft: InterviewQuestionDraft | undefined = await context.ai.askInterviewQuestion(input, {
      attribution: context.attribution,
    });
    if (draft === undefined || !hasOptionAddressingAbsentPartner(draft, absentTerms)) {
      return draft;
    }

    const redrawn: InterviewQuestionDraft | undefined = await context.ai.askInterviewQuestion(input, {
      attribution: context.attribution,
    });
    return this.keepOptionsForPresentPeople(redrawn ?? draft, absentTerms);
  }

  private keepOptionsForPresentPeople(
    draft: InterviewQuestionDraft,
    absentTerms: readonly string[],
  ): InterviewQuestionDraft {
    const kept: InterviewQuestionDraft['options'] = draft.options.filter(
      (option) => !isOptionAddressingAbsentPartner(option.text, absentTerms),
    );
    if (kept.length >= minimumQuestionOptions) {
      return { ...draft, options: kept };
    }

    this.host.logger.warn(
      `인터뷰 선택지가 이 자리에 없는 사람(${absentTerms.join(', ')})을 부릅니다. 고르기 전에 확인하세요.`,
    );
    return draft;
  }

  private async describeActor(
    context: InterviewContext,
    nextBeat: InterviewBeatSituation | undefined,
  ): Promise<InterviewQuestionActor | undefined> {
    if (nextBeat === undefined || context.cardType !== 'character') {
      return undefined;
    }

    return describeBeatActor({
      subject: context.card,
      situation: nextBeat,
      focalRef: await this.resolveSceneFocal(context, nextBeat.sceneStem),
      characters: context.characters,
    });
  }

  private async resolveSceneFocal(context: InterviewContext, sceneStem: string): Promise<string | undefined> {
    const scene: SceneFile | undefined = context.scenes.find((candidate) => candidate.stem === sceneStem);
    if (scene === undefined) {
      return undefined;
    }

    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(context.workspaceRoot);
    const resolver: SceneNarrationResolver = new SceneNarrationResolver(
      this.host.fileSystem,
      this.host.cards,
      this.host.scenes,
    );
    try {
      const narration: NarrationDirective | undefined = await resolver.resolveNarration(
        paths,
        scene,
        context.project,
        await resolver.readChapterDefaults(paths, scene.order),
      );

      return narration?.focal;
    } catch (error) {
      return this.askWithoutFocalWhenNarratorIsMissing(error, sceneStem);
    }
  }

  private askWithoutFocalWhenNarratorIsMissing(error: unknown, sceneStem: string): undefined {
    if (!(error instanceof NarrationError)) {
      throw error;
    }

    this.host.logger.warn(`${sceneStem}: ${error.message} 초점 인물 없이 묻습니다.`);
    return undefined;
  }

  private buildQuestionInput(
    context: InterviewContext,
    openAxes: readonly InterviewAxis[],
    nextBeat: InterviewBeatSituation | undefined,
    actor: InterviewQuestionActor | undefined,
  ): InterviewQuestionInput {
    const { model, tuning } = context;
    const firstOpenAxis: InterviewAxis = openAxes[0] as InterviewAxis;
    const askedAxes: readonly InterviewAxis[] = nextBeat === undefined ? [firstOpenAxis] : openAxes;

    return {
      cardType: context.cardType,
      name: context.card.name,
      genre: context.project.setting?.genre,
      summary: model.summary,
      relationSpeech: describeRelationSpeech(context),
      axes: askedAxes.map(
        (axis): InterviewQuestionAxis => ({
          ...axis,
          unseenValueIds: unseenValueIds(model.tallies, axis),
        }),
      ),
      situation:
        nextBeat === undefined
          ? `${firstOpenAxis.label}이(가) 드러나는 상황을 하나 세워 물어라.`
          : describeBeatSituation(nextBeat),
      ...(nextBeat === undefined
        ? {}
        : { presence: describePresence(nextBeat, context.scenes, context.characters) }),
      ...(actor === undefined ? {} : { actor }),
      isOffBeat: nextBeat === undefined,
      priorAnswers: model.records
        .map((record) => describeRecordAnswer(record, context.axes))
        .filter((line): line is string => line !== undefined)
        .slice(-6),
      optionCount: tuning.optionCount,
      shouldExplore: tuning.explorationOptions > 0 && model.records.length > 0,
    };
  }

  private toRecord(
    sessionId: string,
    context: InterviewContext,
    draft: InterviewQuestionDraft,
    nextBeat: InterviewBeatSituation | undefined,
  ): InterviewRecord {
    const axis: InterviewAxis = this.requireAxis(context.axes, draft.axisId);

    return {
      id: `${sessionId}-${context.model.records.length + 1}`,
      sessionId,
      askedAt: this.now().toISOString(),
      source:
        nextBeat === undefined
          ? { kind: 'offBeat' }
          : { kind: 'beat', sceneStem: nextBeat.sceneStem, beatIndex: nextBeat.beatIndex },
      axisId: axis.id,
      situation: nextBeat === undefined ? draft.question : describeBeatSituation(nextBeat),
      question: draft.question,
      options: this.markExploration(draft, axis, context.model.tallies, context.tuning),
      isConfirmed: false,
    };
  }

  public async answer(request: InterviewAnswerRequest): Promise<InterviewAnswerOutcome> {
    const context: InterviewContext = await this.requireContext(request);
    const record: InterviewRecord = this.requireRecord(context.model, request.questionId);

    if (isRelationRecord(record)) {
      return this.answerRelation(request, context, record, request.answer);
    }

    const axis: InterviewAxis = this.requireAxis(context.axes, record.axisId);

    if (request.answer.kind === 'skipped') {
      const skipped: InterviewRecord = { ...record, answer: { kind: 'skipped' }, isConfirmed: true };
      await this.saveModel(request.workspaceRoot, this.replaceRecord(context.model, skipped));
      return { isRebuilt: false, answeredCount: this.countAnswered(context.model, request.sessionId) + 1 };
    }

    if (request.answer.kind === 'chosen') {
      return this.answerChosen(request, context, record, axis, request.answer.index);
    }

    return this.answerWritten(request, context, record, axis, request.answer.text);
  }

  public async confirm(request: InterviewConfirmRequest): Promise<void> {
    const context: InterviewContext = await this.requireContext(request);
    const record: InterviewRecord = this.requireRecord(context.model, request.questionId);
    const answer: InterviewAnswer | undefined = record.answer;
    if (answer === undefined || answer.kind !== 'written') {
      return;
    }

    const confirmation: InterviewConfirmation = request.confirmation;
    const confirmed: { readonly id: string; readonly label: string } =
      confirmation.kind === 'value'
        ? {
            id: confirmation.valueId,
            label:
              this.requireAxis(context.axes, record.axisId).values.find(
                (value) => value.id === confirmation.valueId,
              )?.label ?? confirmation.valueId,
          }
        : { id: confirmation.id, label: confirmation.label };
    const axes: InterviewAxis[] = withValue(context.axes, record.axisId, confirmed);
    const movedTallies: InterviewTallies = addTally(
      addTally(context.model.tallies, record.axisId, answer.valueId, -context.tuning.writtenWeight),
      record.axisId,
      confirmed.id,
      context.tuning.writtenWeight,
    );

    await this.saveAxes(request.workspaceRoot, context.cardType, axes, context);
    await this.saveModel(request.workspaceRoot, {
      ...this.replaceRecord(context.model, {
        ...record,
        answer: {
          ...answer,
          valueId: confirmed.id,
          isNewValue: confirmed.id === answer.valueId ? answer.isNewValue : confirmation.kind === 'newValue',
        },
        isConfirmed: true,
      }),
      tallies: movedTallies,
    });
  }

  public async finish(request: InterviewSessionRequest): Promise<InterviewSessionSummary> {
    const context: InterviewContext = await this.closeSession(request, await this.requireContext(request));
    const { model } = context;
    const sessionRecords: readonly InterviewRecord[] = model.records.filter(
      (record) => record.sessionId === request.sessionId && record.answer !== undefined,
    );
    const answered: number = sessionRecords.filter((record) => record.answer?.kind !== 'skipped').length;
    const decidedLines: string[] = this.decidedTallyLines(context);
    const summary: Omit<InterviewSessionSummary, 'candidateCount'> = {
      sessionId: request.sessionId,
      cardId: model.cardId,
      answered,
      skipped: sessionRecords.length - answered,
      undecidedAxisLabels: this.undecidedAxisLabels(context, sessionRecords),
    };

    const relationDrafts: CardCollectProposalDraft[] = this.relationSpeechProposals(context);
    const hasNothingNewToDistill: boolean =
      answered === 0 || (decidedLines.length === 0 && relationDrafts.length === 0);
    if (hasNothingNewToDistill) {
      return { ...summary, candidateCount: 0 };
    }

    const distilled: InterviewDistillDraft | undefined =
      decidedLines.length === 0 ? undefined : await this.distill(context, decidedLines);
    const changes: CardCollectProposal[] = this.toProposals(
      distilled,
      relationDrafts,
      context.card,
      model.records,
    );
    if (changes.length > 0) {
      await this.writeCandidates(request, context, changes);
    }
    await this.saveModel(request.workspaceRoot, { ...model, distilledThrough: model.records.length });

    return { ...summary, candidateCount: changes.length };
  }

  private async closeSession(request: InterviewSessionRequest, context: InterviewContext): Promise<InterviewContext> {
    const model: InterviewWorkingModel = closeSessionRecords(context.model, request.sessionId);
    await this.saveModel(request.workspaceRoot, model);

    return { ...context, model };
  }

  private decidedTallyLines(context: InterviewContext): string[] {
    const { model, tuning, axes } = context;

    return axes.flatMap((axis) =>
      Object.entries(model.tallies[axis.id] ?? {})
        .filter(([, weight]) => weight >= tuning.distillMinimumWeight)
        .map(([valueId, weight]) => {
          const label: string = axis.values.find((value) => value.id === valueId)?.label ?? valueId;
          return `${axis.label}: ${label} ×${weight}`;
        }),
    );
  }

  private undecidedAxisLabels(
    context: InterviewContext,
    sessionRecords: readonly InterviewRecord[],
  ): string[] {
    const { model, tuning, axes } = context;

    return axes
      .filter((axis) => {
        const isTouched: boolean =
          model.tallies[axis.id] !== undefined ||
          sessionRecords.some((record) => record.axisId === axis.id);
        return isTouched && !isAxisDecided(model.tallies, axis.id, tuning.distillMinimumWeight);
      })
      .map((axis) => axis.label);
  }

  private distill(context: InterviewContext, decidedLines: readonly string[]): Promise<InterviewDistillDraft> {
    const relationTargets: readonly string[] =
      context.card.type === 'character'
        ? (context.card.relations ?? []).map((relation) => relation.target)
        : [];

    return context.ai.distillInterview(
      {
        cardType: context.cardType,
        name: context.card.name,
        cardText: serializeCard(context.card),
        summary: context.model.summary,
        tallies: decidedLines,
        choices: context.model.records
          .map((record) => describeRecordChoice(record, context.axes))
          .filter((line): line is string => line !== undefined),
        written: writtenAnswers(context.model.records, context.axes),
        relationTargets,
        minimumWeight: context.tuning.distillMinimumWeight,
      },
      { attribution: context.attribution },
    );
  }

  private async writeCandidates(
    request: InterviewSessionRequest,
    context: InterviewContext,
    changes: readonly CardCollectProposal[],
  ): Promise<void> {
    const proposed: StoryboardCard = applyCardCollectProposals(context.card, changes);
    const planned: PlannedCardChanges = await this.host.cards.planCardChanges(
      request.workspaceRoot,
      proposed,
      { origin: 'interview', session: request.sessionId },
    );

    await this.repositories.interviews.savePendingStatements(
      request.workspaceRoot,
      context.card.id,
      planned.statements,
      planned.header,
    );
  }

  private async answerRelation(
    request: InterviewAnswerRequest,
    context: InterviewContext,
    record: InterviewRecord,
    input: InterviewAnswerInput,
  ): Promise<InterviewAnswerOutcome> {
    const answer: InterviewAnswer =
      input.kind === 'written'
        ? { kind: 'written', text: input.text, valueId: 'written', isNewValue: false }
        : input.kind === 'chosen'
          ? { kind: 'chosen', index: input.index }
          : { kind: 'skipped' };
    if (answer.kind === 'chosen' && record.options[answer.index] === undefined) {
      throw new Error(`선택지 ${answer.index + 1} 은 없습니다.`);
    }

    await this.saveModel(
      request.workspaceRoot,
      this.replaceRecord(context.model, { ...record, answer, isConfirmed: true }),
    );

    return {
      isRebuilt: false,
      answeredCount: this.countAnswered(context.model, request.sessionId) + (answer.kind === 'skipped' ? 0 : 1),
    };
  }

  private relationSpeechProposals(context: InterviewContext): CardCollectProposalDraft[] {
    return [...collectAnsweredRelationSpeech(context.model)].map(
      ([target, speech]): CardCollectProposalDraft => ({ kind: 'relationSpeech', target, speech }),
    );
  }

  private async answerChosen(
    request: InterviewAnswerRequest,
    context: InterviewContext,
    record: InterviewRecord,
    axis: InterviewAxis,
    index: number,
  ): Promise<InterviewAnswerOutcome> {
    const option: InterviewOption | undefined = record.options[index];
    if (option === undefined) {
      throw new Error(`선택지 ${index + 1} 은 없습니다.`);
    }

    const answered: InterviewRecord = { ...record, answer: { kind: 'chosen', index }, isConfirmed: true };
    const update: InterviewUpdateDraft | undefined = await context.ai.updateInterviewModel(
      {
        cardType: context.cardType,
        name: context.card.name,
        summary: context.model.summary,
        relationSpeech: describeRelationSpeech(context),
        axis,
        situation: record.situation,
        question: record.question,
        options: record.options,
        answer: option.text,
        isWritten: false,
      },
      { attribution: context.attribution },
    );

    await this.saveModel(request.workspaceRoot, {
      ...this.replaceRecord(context.model, answered),
      summary: update?.summary ?? context.model.summary,
      tallies: addTally(context.model.tallies, axis.id, option.valueId, context.tuning.chosenWeight),
      writtenStreak: 0,
    });

    return { isRebuilt: false, answeredCount: this.countAnswered(context.model, request.sessionId) + 1 };
  }

  private async answerWritten(
    request: InterviewAnswerRequest,
    context: InterviewContext,
    record: InterviewRecord,
    axis: InterviewAxis,
    text: string,
  ): Promise<InterviewAnswerOutcome> {
    const update: InterviewUpdateDraft | undefined = await context.ai.updateInterviewModel(
      {
        cardType: context.cardType,
        name: context.card.name,
        summary: context.model.summary,
        relationSpeech: describeRelationSpeech(context),
        axis,
        situation: record.situation,
        question: record.question,
        options: record.options,
        answer: text,
        isWritten: true,
      },
      { attribution: context.attribution },
    );
    const classification: InterviewClassification = this.classify(update, axis);
    const axes: InterviewAxis[] = withValue(context.axes, axis.id, {
      id: classification.valueId,
      label: classification.valueLabel,
    });
    const writtenStreak: number = context.model.writtenStreak + 1;
    const shouldRebuild: boolean = writtenStreak >= context.tuning.rebuildAfterWrittenStreak;
    const answered: InterviewRecord = {
      ...record,
      answer: {
        kind: 'written',
        text,
        valueId: classification.valueId,
        isNewValue: classification.isNewValue,
      },
      isConfirmed: false,
    };
    const updatedModel: InterviewWorkingModel = {
      ...this.replaceRecord(context.model, answered),
      summary: update?.summary ?? context.model.summary,
      tallies: addTally(context.model.tallies, axis.id, classification.valueId, context.tuning.writtenWeight),
      writtenStreak: shouldRebuild ? 0 : writtenStreak,
    };
    const rebuiltSummary: string | undefined = shouldRebuild
      ? await this.rebuildSummary(context, axes, updatedModel, record, text)
      : undefined;

    await this.saveAxes(request.workspaceRoot, context.cardType, axes, context);
    await this.saveModel(request.workspaceRoot, {
      ...updatedModel,
      summary: rebuiltSummary ?? updatedModel.summary,
    });

    return {
      classification,
      isRebuilt: rebuiltSummary !== undefined,
      answeredCount: this.countAnswered(context.model, request.sessionId) + 1,
    };
  }

  private async rebuildSummary(
    context: InterviewContext,
    axes: readonly InterviewAxis[],
    model: InterviewWorkingModel,
    record: InterviewRecord,
    answerText: string,
  ): Promise<string | undefined> {
    const rebuilt: InterviewUpdateDraft | undefined = await context.ai.updateInterviewModel(
      {
        cardType: context.cardType,
        name: context.card.name,
        summary: model.summary,
        relationSpeech: describeRelationSpeech(context),
        axis: this.requireAxis(axes, record.axisId),
        situation: record.situation,
        question: record.question,
        options: record.options,
        answer: answerText,
        isWritten: false,
        rebuild: {
          cardText: serializeCard(context.card),
          records: model.records
            .map((entry) => describeRecordAnswer(entry, axes))
            .filter((line): line is string => line !== undefined),
        },
      },
      { attribution: context.attribution },
    );

    return rebuilt?.summary;
  }

  private classify(update: InterviewUpdateDraft | undefined, axis: InterviewAxis): InterviewClassification {
    const classification: InterviewClassificationDraft | undefined = update?.classification;

    if (classification?.kind === 'newValue') {
      return { valueId: classification.id, valueLabel: classification.label, isNewValue: true };
    }

    const valueId: string = classification?.kind === 'value' ? classification.valueId : (axis.values[0]?.id ?? 'unclassified');
    const valueLabel: string = axis.values.find((value) => value.id === valueId)?.label ?? valueId;

    return { valueId, valueLabel, isNewValue: false };
  }

  private markExploration(
    draft: InterviewQuestionDraft,
    axis: InterviewAxis,
    tallies: InterviewTallies,
    tuning: InterviewTuning,
  ): InterviewOption[] {
    const unseen: readonly string[] = unseenValueIds(tallies, axis);
    const hasTallies: boolean = Object.keys(tallies[axis.id] ?? {}).length > 0;
    let explorationBudget: number = hasTallies ? tuning.explorationOptions : 0;

    return draft.options.map((option) => {
      const isExploration: boolean = explorationBudget > 0 && unseen.includes(option.valueId);
      if (isExploration) {
        explorationBudget -= 1;
      }

      return { valueId: option.valueId, text: option.text, isExploration };
    });
  }

  private toProposals(
    distilled: InterviewDistillDraft | undefined,
    relationDrafts: readonly CardCollectProposalDraft[],
    card: StoryboardCard,
    sessionRecords: readonly InterviewRecord[],
  ): CardCollectProposal[] {
    const sourceScenes: string[] = [
      ...new Set(
        sessionRecords.flatMap((record) =>
          record.source.kind === 'beat' ? [record.source.sceneStem] : [],
        ),
      ),
    ];
    const drafts: CardCollectProposalDraft[] = [
      ...relationDrafts,
      ...(distilled === undefined ? [] : this.proposalDraftsFrom(distilled)),
    ];

    return drafts
      .map(
        (draft): CardCollectProposal =>
          ({ ...draft, id: cardCollectProposalId(draft), sourceScenes }) as CardCollectProposal,
      )
      .filter((proposal) => shouldProposeCardCollect(card, proposal));
  }

  private toQuestion(record: InterviewRecord, axes: readonly InterviewAxis[]): InterviewQuestion {
    const axis: InterviewAxis | undefined = axes.find((candidate) => candidate.id === record.axisId);
    const axisLabel: string = isRelationRecord(record)
      ? `호칭과 말투 · ${record.situation}`
      : (axis?.label ?? record.axisId);

    return {
      id: record.id,
      sessionId: record.sessionId,
      axisId: record.axisId,
      axisLabel,
      values: axis?.values ?? [],
      source: record.source,
      situation: record.situation,
      question: record.question,
      options: record.options,
    };
  }

  private describeCoverage(context: InterviewContext): InterviewCardCoverage {
    const situations: InterviewBeatSituation[] = collectBeatSituations(context.card, context.scenes, context.situationOptions);

    return {
      cardId: context.card.id,
      cardType: context.cardType,
      name: context.card.name,
      hasWorkingModel: context.model.records.length > 0,
      openAxes: listOpenAxes(
        context.axes,
        context.model.tallies,
        context.tuning.distillMinimumWeight,
        situations,
      ),
      upcomingSceneStems: [...new Set(context.scenes.map((scene) => scene.stem))],
    };
  }

  private async resolveCard(
    request: Pick<InterviewSessionRequest, 'workspaceRoot' | 'cardId' | 'card'>,
  ): Promise<StoryboardCard | undefined> {
    if (request.card !== undefined) {
      return request.card;
    }

    return await this.repositories.noteAbsorb.loadCard(request.workspaceRoot, this.cardKind, request.cardId);
  }

  private async requireContext(request: InterviewSessionRequest): Promise<InterviewContext> {
    const card: StoryboardCard | undefined = await this.resolveCard(request);
    if (card === undefined) {
      throw new Error(`카드 ${request.cardId} 를 찾을 수 없습니다.`);
    }

    return this.loadContext(request.workspaceRoot, card, request.sceneStems, request.sessionId);
  }

  private async loadContext(
    workspaceRoot: StoryUri,
    card: StoryboardCard,
    requestedStems: readonly string[] | undefined,
    sessionId: string,
  ): Promise<InterviewContext> {
    const cardType: BibleSubjectKind = cardTypeOf(card);
    const tuning: InterviewTuning = resolveInterviewTuning(
      this.host.configBridge.getSceneGenerationTuning(),
    );
    const project: StoryboardProject = await this.repositories.project.read(
      getStoryboardProjectPaths(workspaceRoot).projectJson,
    );
    const ai: StoryboardAiService = this.aiServices.gateway.createService(workspaceRoot);
    const attribution: UsageAttribution = { primary: { kind: cardType, id: card.id } };
    const scenes: SceneFile[] = await this.loadUpcomingScenes(workspaceRoot, tuning, requestedStems);
    const axes: readonly InterviewAxis[] = await this.ensureAxes(
      workspaceRoot,
      cardType,
      project,
      scenes,
      tuning,
      ai,
      attribution,
    );
    const model: InterviewWorkingModel = await this.ensureWorkingModel(workspaceRoot, card, cardType, sessionId);
    const situationOptions: BeatSituationOptions = await this.situationOptionsFor(workspaceRoot, card);

    const relationTargetNames: ReadonlyMap<string, string> = await this.loadRelationTargetNames(
      workspaceRoot,
      card,
    );

    return {
      workspaceRoot,
      card,
      cardType,
      situationOptions,
      project,
      scenes,
      axes,
      model,
      tuning,
      ai,
      attribution,
      relationTargetNames,
      characters: await this.loadCards(workspaceRoot, 'character'),
    };
  }

  private async loadRelationTargetNames(
    workspaceRoot: StoryUri,
    card: StoryboardCard,
  ): Promise<ReadonlyMap<string, string>> {
    const names: Map<string, string> = new Map<string, string>();
    if (card.type !== 'character') {
      return names;
    }

    for (const relation of card.relations ?? []) {
      const target: StoryboardCard | undefined = await this.repositories.noteAbsorb.loadCard(
        workspaceRoot,
        'character',
        relation.target,
      );
      names.set(relation.target, target?.name ?? relation.target);
    }

    return names;
  }

  protected async loadCards(workspaceRoot: StoryUri, kind: BibleSubjectKind): Promise<StoryboardCard[]> {
    const cards: StoryboardCard[] = [];

    for (const summary of await this.repositories.cardSidebar.list(workspaceRoot, kind)) {
      const card: StoryboardCard | undefined = await this.repositories.noteAbsorb.loadCard(
        workspaceRoot,
        kind,
        summary.id,
      );
      if (card !== undefined) {
        cards.push(card);
      }
    }

    return cards;
  }

  private async loadUpcomingScenes(
    workspaceRoot: StoryUri,
    tuning: InterviewTuning,
    requestedStems: readonly string[] | undefined,
  ): Promise<SceneFile[]> {
    const listed: SceneListItem[] = await this.repositories.sceneSidebar.list(workspaceRoot);
    const chosen: SceneListItem[] = chooseUpcomingScenes(listed, tuning.upcomingScenes, requestedStems);
    const scenes: SceneFile[] = [];

    for (const item of chosen) {
      scenes.push(
        await this.repositories.scenes.read(scenePath(workspaceRoot, item.stem)),
      );
    }

    return scenes;
  }

  private async ensureAxes(
    workspaceRoot: StoryUri,
    cardType: BibleSubjectKind,
    project: StoryboardProject,
    scenes: readonly SceneFile[],
    tuning: InterviewTuning,
    ai: StoryboardAiService,
    attribution: UsageAttribution,
  ): Promise<readonly InterviewAxis[]> {
    const file: InterviewAxesFile = await this.repositories.interviews.loadAxes(workspaceRoot);
    const existing: InterviewAxisSet | undefined = file[cardType];
    if (existing !== undefined && existing.axes.length > 0) {
      return existing.axes;
    }

    const synopsis: OutlineSynopsis | undefined = await this.repositories.outline.loadSynopsis(workspaceRoot);
    const proposed: InterviewAxis[] = await ai.proposeInterviewAxes(
      {
        cardType,
        genre: project.setting?.genre,
        audience: project.setting?.audience,
        concept: project.setting?.concept ?? project.setting?.description,
        synopsis: synopsis === undefined ? undefined : [synopsis.logline, synopsis.tone].filter(Boolean).join(' / '),
        prohibitions: project.setting?.prohibitions ?? [],
        existingAxes: [],
        scenes: scenes.map(describeSceneKind),
        maxAxes: tuning.axesPerCardType,
      },
      { attribution },
    );
    const axes: InterviewAxis[] = proposed.slice(0, tuning.axesPerCardType);
    if (axes.length === 0) {
      throw new Error('인터뷰 축을 만들지 못했습니다. 작품 계약(장르·컨셉)을 채우고 다시 시도하세요.');
    }

    await this.repositories.interviews.saveAxes(workspaceRoot, {
      ...file,
      [cardType]: {
        generatedAt: this.now().toISOString(),
        contractHash: computeInterviewContractHash(project.setting),
        axes,
      },
    });

    return axes;
  }

  private async ensureWorkingModel(
    workspaceRoot: StoryUri,
    card: StoryboardCard,
    cardType: BibleSubjectKind,
    sessionId: string,
  ): Promise<InterviewWorkingModel> {
    const cardHash: string = cardHashOf(card);
    const existing: InterviewWorkingModel | undefined =
      await this.repositories.interviews.loadWorkingModel(workspaceRoot, card.id);

    if (existing !== undefined) {
      return existing.cardHash === cardHash ? existing : { ...existing, cardHash, writtenStreak: 0 };
    }

    const fresh: InterviewWorkingModel = {
      version: 1,
      cardId: card.id,
      cardType,
      cardHash,
      summary: serializeCard(card),
      tallies: emptyTallies,
      records: [],
      writtenStreak: 0,
      distilledThrough: 0,
    };
    await this.repositories.interviews.saveWorkingModel(workspaceRoot, fresh);
    void sessionId;

    return fresh;
  }

  private async isContractStale(workspaceRoot: StoryUri, context: InterviewContext): Promise<boolean> {
    const file: InterviewAxesFile = await this.repositories.interviews.loadAxes(workspaceRoot);
    const set: InterviewAxisSet | undefined = file[context.cardType];

    return (
      set !== undefined && set.contractHash !== computeInterviewContractHash(context.project.setting)
    );
  }

  private async saveAxes(
    workspaceRoot: StoryUri,
    cardType: BibleSubjectKind,
    axes: readonly InterviewAxis[],
    context: InterviewContext,
  ): Promise<void> {
    if (axes === context.axes) {
      return;
    }

    const file: InterviewAxesFile = await this.repositories.interviews.loadAxes(workspaceRoot);
    const set: InterviewAxisSet | undefined = file[cardType];
    await this.repositories.interviews.saveAxes(workspaceRoot, {
      ...file,
      [cardType]: {
        generatedAt: set?.generatedAt ?? this.now().toISOString(),
        contractHash: set?.contractHash ?? computeInterviewContractHash(context.project.setting),
        axes,
      },
    });
  }

  private saveModel(workspaceRoot: StoryUri, model: InterviewWorkingModel): Promise<void> {
    return this.repositories.interviews.saveWorkingModel(workspaceRoot, model);
  }

  private replaceRecord(model: InterviewWorkingModel, record: InterviewRecord): InterviewWorkingModel {
    return {
      ...model,
      records: model.records.map((existing) => (existing.id === record.id ? record : existing)),
    };
  }

  private requireRecord(model: InterviewWorkingModel, questionId: string): InterviewRecord {
    const record: InterviewRecord | undefined = model.records.find((entry) => entry.id === questionId);
    if (record === undefined) {
      throw new Error(`질문 ${questionId} 을 찾을 수 없습니다.`);
    }

    return record;
  }

  private requireAxis(axes: readonly InterviewAxis[], axisId: string): InterviewAxis {
    const axis: InterviewAxis | undefined = axes.find((candidate) => candidate.id === axisId);
    if (axis === undefined) {
      throw new Error(`축 ${axisId} 을 찾을 수 없습니다.`);
    }

    return axis;
  }

  private countAnswered(model: InterviewWorkingModel, sessionId: string): number {
    return model.records.filter(
      (record) => record.sessionId === sessionId && record.answer !== undefined,
    ).length;
  }
}
