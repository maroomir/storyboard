import { randomUUID } from 'node:crypto';

import type {
  NarratorInterviewAnswer,
  NarratorInterviewQuestionDraft,
  NarratorInterviewVoice,
  StoryboardAiService,
} from '@storyboard/story-ai';
import {
  getStoryboardProjectPaths,
  narrativeTenseLabels,
  narratorKnowledgeLabels,
  narratorPersonLabels,
  scenePath,
  sceneBeatText,
  type InterviewAnswer,
  type InterviewAnswerOutcome,
  type InterviewBeatSituation,
  type InterviewCardCoverage,
  type InterviewOpening,
  type InterviewQuestion,
  type InterviewRecord,
  type InterviewSessionSummary,
  type InterviewWorkingModel,
  type NarrationDirective,
  type NarratorCard,
  type SceneFile,
  type SceneListItem,
  type Statement,
  type StoryboardProject,
  type StoryboardProjectPaths,
  type StoryUri,
  type UsageAttribution,
} from '@storyboard/story-model';

import type {
  AiServices,
  HostAdapters,
  WorkspaceRepositories,
} from '#engine/application/engineServices';
import { SceneNarrationResolver } from '#engine/application/drafts/sceneNarrationResolver';
import { chooseUpcomingScenes } from '#engine/application/interviews/interviewCoverage';
import {
  resolveInterviewTuning,
  type InterviewTuning,
} from '#engine/application/interviews/interviewTuning';
import type {
  InterviewAnswerRequest,
  InterviewConfirmRequest,
  InterviewOpenSession,
  InterviewResumeRequest,
  InterviewSessionRequest,
  InterviewStartRequest,
  InterviewStartResult,
  IQuestionStrategy,
} from '#engine/application/interviews/questionStrategy';
import { failedResult } from '#engine/application/useCase';
import type { CardRoster } from '#engine/persistence/bundles/workspaceCards';

const narrationAxisId: string = 'narration';
const narrationAxisLabel: string = '서술 방식';
const writtenNarrationValueId: string = 'written';
const sessionIdTimestampDigits: number = 17;

interface NarratorInterviewContext {
  readonly workspaceRoot: StoryUri;
  readonly narrator: NarratorCard;
  readonly model: InterviewWorkingModel;
  readonly beats: readonly InterviewBeatSituation[];
  readonly sceneTitles: ReadonlyMap<string, string>;
  readonly tuning: InterviewTuning;
  readonly ai: StoryboardAiService;
  readonly attribution: UsageAttribution;
}

function narratorHashOf(narrator: NarratorCard): string {
  return JSON.stringify(narrator);
}

function describeNarrator(narrator: NarratorCard, focalName: string | undefined): NarratorInterviewVoice {
  return {
    name: narrator.name,
    person: narratorPersonLabels[narrator.person],
    knowledge: narratorKnowledgeLabels[narrator.knowledge],
    ...(narrator.tense === undefined ? {} : { tense: narrativeTenseLabels[narrator.tense] }),
    ...(focalName === undefined ? {} : { focal: focalName }),
    description: narrator.description ?? [],
    voice: narrator.voice ?? [],
  };
}

function isAskedBeat(model: InterviewWorkingModel, beat: InterviewBeatSituation): boolean {
  return model.records.some(
    (record) =>
      record.source.kind === 'beat' &&
      record.source.sceneStem === beat.sceneStem &&
      record.source.beatIndex === beat.beatIndex,
  );
}

function answerTextOf(record: InterviewRecord): string | undefined {
  const answer: InterviewAnswer | undefined = record.answer;
  if (answer === undefined || answer.kind === 'skipped') {
    return undefined;
  }

  return answer.kind === 'written' ? answer.text : record.options[answer.index]?.text;
}

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

function toAnswer(input: InterviewAnswerRequest['answer']): InterviewAnswer {
  return input.kind === 'written'
    ? { kind: 'written', text: input.text.trim(), valueId: writtenNarrationValueId, isNewValue: false }
    : input;
}

function toQuestion(record: InterviewRecord): InterviewQuestion {
  return {
    id: record.id,
    sessionId: record.sessionId,
    axisId: record.axisId,
    axisLabel: narrationAxisLabel,
    values: [],
    source: record.source,
    situation: record.situation,
    question: record.question,
    options: record.options,
  };
}

function sceneBeats(scene: SceneFile): InterviewBeatSituation[] {
  const beats: readonly string[] = (scene.card.beats ?? []).map(sceneBeatText);
  const situations: readonly string[] =
    beats.length > 0 ? beats : [scene.summaryText?.trim() ?? scene.card.title ?? scene.stem];

  return situations
    .filter((text) => text.length > 0)
    .map((text, beatIndex): InterviewBeatSituation => ({ sceneStem: scene.stem, beatIndex, text, cast: [] }));
}

export class NarratorInterviewStrategy implements IQuestionStrategy {
  public constructor(
    private readonly host: HostAdapters,
    private readonly aiServices: AiServices,
    private readonly repositories: WorkspaceRepositories,
    private readonly now: () => Date = (): Date => new Date(),
  ) {}

  public async start(request: InterviewStartRequest): Promise<InterviewStartResult> {
    try {
      const narrator: NarratorCard | undefined = await this.findNarrator(request.workspaceRoot, request.cardId);
      if (narrator === undefined) {
        return { ok: false, kind: 'card-not-found', message: `카드 ${request.cardId} 를 찾을 수 없습니다.` };
      }

      if (request.shouldResetAxes === true) {
        await this.repositories.interviews.saveAxes(request.workspaceRoot, { version: 1 });
        await this.repositories.interviews.deleteWorkingModels(request.workspaceRoot);
      }

      const sessionId: string = this.now().toISOString().replace(/[-:.TZ]/g, '').slice(0, sessionIdTimestampDigits);
      const context: NarratorInterviewContext = await this.loadContext(request, narrator);
      const model: InterviewWorkingModel = {
        ...context.model,
        records: context.model.records.filter((record) => record.answer !== undefined),
      };
      await this.repositories.interviews.saveWorkingModel(request.workspaceRoot, model);

      return { ok: true, opening: this.describeOpening(sessionId, { ...context, model }) };
    } catch (error) {
      this.host.logger.error('Narrator interview start failed', error);
      return failedResult(error);
    }
  }

  public async findOpenSession(request: InterviewResumeRequest): Promise<InterviewOpenSession | undefined> {
    const narrator: NarratorCard | undefined = await this.findNarrator(request.workspaceRoot, request.cardId);
    const model: InterviewWorkingModel | undefined =
      narrator === undefined
        ? undefined
        : await this.repositories.interviews.loadWorkingModel(request.workspaceRoot, narrator.id);
    const latest: InterviewRecord | undefined = model?.records.at(-1);
    if (narrator === undefined || latest === undefined || latest.answer !== undefined) {
      return undefined;
    }

    const context: NarratorInterviewContext = await this.loadContext(request, narrator);
    return {
      opening: this.describeOpening(latest.sessionId, context),
      question: toQuestion(latest),
      step: { kind: 'answer' },
      answeredCount: this.countAnswered(context.model, latest.sessionId),
    };
  }

  public async abandon(request: InterviewSessionRequest): Promise<void> {
    const model: InterviewWorkingModel | undefined = await this.repositories.interviews.loadWorkingModel(
      request.workspaceRoot,
      request.cardId,
    );
    if (model !== undefined) {
      await this.repositories.interviews.saveWorkingModel(
        request.workspaceRoot,
        closeSessionRecords(model, request.sessionId),
      );
    }
  }

  public async next(request: InterviewSessionRequest): Promise<InterviewQuestion | undefined> {
    const context: NarratorInterviewContext = await this.requireContext(request);
    const sessionRecords: readonly InterviewRecord[] = context.model.records.filter(
      (record) => record.sessionId === request.sessionId,
    );
    const pending: InterviewRecord | undefined = sessionRecords.find((record) => record.answer === undefined);
    if (pending !== undefined) {
      return toQuestion(pending);
    }

    const beat: InterviewBeatSituation | undefined = context.beats.find((candidate) => !isAskedBeat(context.model, candidate));
    if (beat === undefined || sessionRecords.length >= context.tuning.maxQuestionsPerSession) {
      return undefined;
    }

    return await this.ask(request.sessionId, context, beat);
  }

  public async answer(request: InterviewAnswerRequest): Promise<InterviewAnswerOutcome> {
    const context: NarratorInterviewContext = await this.requireContext(request);
    const answer: InterviewAnswer = toAnswer(request.answer);
    const model: InterviewWorkingModel = {
      ...context.model,
      records: context.model.records.map((record) =>
        record.id === request.questionId ? { ...record, answer, isConfirmed: true } : record,
      ),
    };
    await this.repositories.interviews.saveWorkingModel(request.workspaceRoot, model);

    return { isRebuilt: false, answeredCount: this.countAnswered(model, request.sessionId) };
  }

  public async confirm(_request: InterviewConfirmRequest): Promise<void> {
    return Promise.resolve();
  }

  public async finish(request: InterviewSessionRequest): Promise<InterviewSessionSummary> {
    const context: NarratorInterviewContext = await this.requireContext(request);
    const sessionRecords: readonly InterviewRecord[] = context.model.records.filter(
      (record) => record.sessionId === request.sessionId && record.answer !== undefined,
    );
    const voiceLines: readonly string[] = await this.distillVoice(context, sessionRecords);
    if (voiceLines.length > 0) {
      await this.repositories.interviews.savePendingStatements(
        request.workspaceRoot,
        context.narrator.id,
        voiceLines.map(
          (value): Statement => ({ facet: 'voice', value, source: { origin: 'interview', session: request.sessionId } }),
        ),
      );
    }
    await this.repositories.interviews.saveWorkingModel(
      request.workspaceRoot,
      closeSessionRecords(context.model, request.sessionId),
    );

    return {
      sessionId: request.sessionId,
      cardId: context.narrator.id,
      answered: sessionRecords.filter((record) => record.answer?.kind !== 'skipped').length,
      skipped: sessionRecords.filter((record) => record.answer?.kind === 'skipped').length,
      candidateCount: voiceLines.length,
      undecidedAxisLabels: [],
    };
  }

  private async ask(
    sessionId: string,
    context: NarratorInterviewContext,
    beat: InterviewBeatSituation,
  ): Promise<InterviewQuestion | undefined> {
    const draft: NarratorInterviewQuestionDraft | undefined = await context.ai.askNarratorQuestion(
      {
        narrator: describeNarrator(context.narrator, await this.focalNameOf(context)),
        sceneTitle: context.sceneTitles.get(beat.sceneStem) ?? beat.sceneStem,
        situation: beat.text,
        priorAnswers: context.model.records.flatMap((record) => answerTextOf(record) ?? []),
        optionCount: context.tuning.optionCount,
      },
      { attribution: context.attribution },
    );
    if (draft === undefined) {
      return undefined;
    }

    const record: InterviewRecord = {
      id: randomUUID(),
      sessionId,
      askedAt: this.now().toISOString(),
      source: { kind: 'beat', sceneStem: beat.sceneStem, beatIndex: beat.beatIndex },
      axisId: narrationAxisId,
      situation: beat.text,
      question: draft.question,
      options: draft.options.map((text) => ({ valueId: narrationAxisId, text, isExploration: false })),
      isConfirmed: false,
    };
    await this.repositories.interviews.saveWorkingModel(context.workspaceRoot, {
      ...context.model,
      records: [...context.model.records, record],
    });

    return toQuestion(record);
  }

  private async distillVoice(
    context: NarratorInterviewContext,
    records: readonly InterviewRecord[],
  ): Promise<readonly string[]> {
    const answers: NarratorInterviewAnswer[] = records.flatMap((record): NarratorInterviewAnswer[] => {
      const answer: string | undefined = answerTextOf(record);
      return answer === undefined ? [] : [{ situation: record.situation, answer }];
    });
    if (answers.length === 0) {
      return [];
    }

    const existing: ReadonlySet<string> = new Set(context.narrator.voice ?? []);
    const distilled: readonly string[] = await context.ai.distillNarratorInterview(
      { narrator: describeNarrator(context.narrator, await this.focalNameOf(context)), answers },
      { attribution: context.attribution },
    );
    return distilled.filter((line) => !existing.has(line));
  }

  private countAnswered(model: InterviewWorkingModel, sessionId: string): number {
    return model.records.filter(
      (record) => record.sessionId === sessionId && record.answer !== undefined && record.answer.kind !== 'skipped',
    ).length;
  }

  private describeOpening(sessionId: string, context: NarratorInterviewContext): InterviewOpening {
    return {
      sessionId,
      cardId: context.narrator.id,
      cardType: 'narrator',
      name: context.narrator.name,
      coverage: this.describeCoverage(context),
      isContractStale: false,
      maxQuestions: context.tuning.maxQuestionsPerSession,
    };
  }

  private describeCoverage(context: NarratorInterviewContext): InterviewCardCoverage {
    const openBeats: InterviewBeatSituation[] = context.beats.filter((beat) => !isAskedBeat(context.model, beat));

    return {
      cardId: context.narrator.id,
      cardType: 'narrator',
      name: context.narrator.name,
      hasWorkingModel: context.model.records.length > 0,
      openAxes:
        openBeats.length === 0
          ? []
          : [{ axisId: narrationAxisId, axisLabel: narrationAxisLabel, beatSituations: openBeats }],
      upcomingSceneStems: [...new Set(context.beats.map((beat) => beat.sceneStem))],
    };
  }

  private async findNarrator(workspaceRoot: StoryUri, cardId: string): Promise<NarratorCard | undefined> {
    return (await this.host.cards.loadRoster(workspaceRoot, ['narrator'])).narrators.find(
      (narrator) => narrator.id === cardId,
    );
  }

  private async focalNameOf(context: NarratorInterviewContext): Promise<string | undefined> {
    const focal: string | undefined = context.narrator.focal;
    if (focal === undefined) {
      return undefined;
    }

    const roster: CardRoster = await this.host.cards.loadRoster(context.workspaceRoot, ['character']);
    return roster.characters.find((character) => character.id === focal)?.name ?? focal;
  }

  private async requireContext(request: InterviewSessionRequest): Promise<NarratorInterviewContext> {
    const narrator: NarratorCard | undefined = await this.findNarrator(request.workspaceRoot, request.cardId);
    if (narrator === undefined) {
      throw new Error(`카드 ${request.cardId} 를 찾을 수 없습니다.`);
    }

    return await this.loadContext(request, narrator);
  }

  private async loadContext(
    request: Pick<InterviewSessionRequest, 'workspaceRoot' | 'sceneStems'>,
    narrator: NarratorCard,
  ): Promise<NarratorInterviewContext> {
    const { workspaceRoot } = request;
    const tuning: InterviewTuning = resolveInterviewTuning(this.host.configBridge.getSceneGenerationTuning());
    const scenes: readonly SceneFile[] = await this.loadNarratedScenes(workspaceRoot, narrator, tuning, request.sceneStems);

    return {
      workspaceRoot,
      narrator,
      model: await this.loadModel(workspaceRoot, narrator),
      beats: scenes.flatMap(sceneBeats),
      sceneTitles: new Map(scenes.map((scene) => [scene.stem, scene.card.title ?? scene.stem])),
      tuning,
      ai: this.aiServices.gateway.createService(workspaceRoot),
      attribution: { primary: { kind: 'narrator', id: narrator.id } },
    };
  }

  private async loadModel(workspaceRoot: StoryUri, narrator: NarratorCard): Promise<InterviewWorkingModel> {
    const cardHash: string = narratorHashOf(narrator);
    const existing: InterviewWorkingModel | undefined = await this.repositories.interviews.loadWorkingModel(
      workspaceRoot,
      narrator.id,
    );
    if (existing !== undefined) {
      return existing.cardHash === cardHash ? existing : { ...existing, cardHash };
    }

    return {
      version: 1,
      cardId: narrator.id,
      cardType: 'narrator',
      cardHash,
      summary: '',
      tallies: {},
      records: [],
      writtenStreak: 0,
      distilledThrough: 0,
    };
  }

  private async loadNarratedScenes(
    workspaceRoot: StoryUri,
    narrator: NarratorCard,
    tuning: InterviewTuning,
    requestedStems: readonly string[] | undefined,
  ): Promise<SceneFile[]> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(workspaceRoot);
    const project: StoryboardProject = await this.repositories.project.read(paths.projectJson);
    const resolver: SceneNarrationResolver = new SceneNarrationResolver(this.host.fileSystem, this.host.cards, this.host.scenes);
    const narrated: SceneListItem[] = [];
    const scenesByStem: Map<string, SceneFile> = new Map<string, SceneFile>();

    for (const item of await this.repositories.sceneSidebar.list(workspaceRoot)) {
      const scene: SceneFile = await this.repositories.scenes.read(scenePath(workspaceRoot, item.stem));
      const directive: NarrationDirective | undefined = await resolver.resolveNarration(
        paths,
        scene,
        project,
        await resolver.readChapterDefaults(paths, scene.order),
      );
      if (directive?.narratorId === narrator.id) {
        narrated.push(item);
        scenesByStem.set(item.stem, scene);
      }
    }

    return chooseUpcomingScenes(narrated, tuning.upcomingScenes, requestedStems).flatMap(
      (item) => scenesByStem.get(item.stem) ?? [],
    );
  }
}
