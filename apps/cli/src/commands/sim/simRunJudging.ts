import type { AiProviderRegistry } from '@storyboard/story-ai';
import type { IStoryboardLogger } from '@storyboard/story-engine';
import { extractErrorMessage, type AiProviderId } from '@storyboard/story-model';
import {
  createFactRecallJudge,
  createSimJudge,
  judgeAxis,
  judgeChain,
  scoreFactRecall,
  type AxisScene,
  type AxisVerdict,
  type FactRecallReport,
  type PanelVerdict,
  type RejudgeSource,
  type RunRecord,
  type SceneDraft,
  type SimJudge,
} from '@storyboard/story-sim';
import { judgeUsageTotals, type JudgeMaterials, type Selection, type TrackScene } from '@/commands/sim/simTrack';

export interface SimRunJudgingDependencies {
  readonly logger: IStoryboardLogger;
  readonly registry: AiProviderRegistry;
}

interface DraftJudgement {
  readonly generation: Selection;
  readonly scenes: readonly TrackScene[];
  readonly drafts: ReadonlyMap<string, string>;
  readonly label: string;
  readonly draftsDir: string;
}

interface ChainJudgement extends DraftJudgement {
  readonly judge: Selection;
  readonly materials: JudgeMaterials;
}

export interface RepeatJudgement extends DraftJudgement {
  readonly judge: Selection | undefined;
  readonly materials: JudgeMaterials | undefined;
}

export interface KeptDraftsJudgement {
  readonly source: RejudgeSource;
  readonly judge: Selection;
  readonly materials: JudgeMaterials;
  readonly scenes: readonly TrackScene[];
  readonly drafts: ReadonlyMap<string, string>;
}

function createAxisScenes(
  scenes: readonly TrackScene[],
  drafts: ReadonlyMap<string, string>,
  axisFloors: ReadonlyMap<string, string>,
): AxisScene[] {
  return scenes.flatMap((scene) => {
    const draft: string | undefined = drafts.get(scene.sceneStem);
    const floorDraft: string | undefined = axisFloors.get(scene.sceneStem);
    return draft === undefined
      ? []
      : [
          {
            sceneStem: scene.sceneStem,
            axis: scene.title,
            question: scene.purpose,
            draft,
            ...(floorDraft === undefined ? {} : { floorDraft }),
          },
        ];
  });
}

function describeAxisVerdict(verdict: AxisVerdict): string {
  return `${verdict.sceneStem} · ${verdict.axis} · ${verdict.verdict}${verdict.discarded ? ` (폐기: ${verdict.discardReason ?? ''})` : ''}`;
}

function orderChainDrafts(input: ChainJudgement): SceneDraft[] {
  return input.scenes
    .map((scene) => ({ sceneStem: scene.sceneStem, draft: input.drafts.get(scene.sceneStem) }))
    .filter((scene): scene is SceneDraft => scene.draft !== undefined);
}

function createCriticFields(verdict: PanelVerdict): Partial<RunRecord> {
  return verdict.critic === undefined
    ? {}
    : {
        critic: {
          groundedTotal: verdict.critic.groundedTotal,
          opinionTotal: verdict.critic.opinionTotal,
          gatePassed: verdict.critic.gate.passed,
          scores: verdict.critic.scores,
          gateReason: verdict.critic.gate.reason,
          problems: verdict.critic.problems,
        },
      };
}

function createPanelVerdictFields(verdict: PanelVerdict): Partial<RunRecord> {
  return {
    auc: verdict.discarded ? undefined : verdict.auc.auc,
    discarded: verdict.discarded,
    ...(verdict.discarded ? { discardReasons: verdict.discardReasons } : {}),
    floorGate: verdict.floor,
    panel: {
      byReader: verdict.auc.byReader,
      curves: verdict.auc.curves,
      dropOffScene: verdict.auc.dropOffScene,
      engagement: verdict.auc.engagement,
      engagementByReader: verdict.auc.engagementByReader,
    },
    genreNotes: verdict.genreNotes,
    ...(verdict.genreProblems.length > 0 ? { genreProblems: verdict.genreProblems } : {}),
    ...createCriticFields(verdict),
  };
}

function describeKeptVerdictProblems(
  label: string,
  draftsDir: string,
  verdict: PanelVerdict,
): string[] {
  return [
    ...(verdict.discarded
      ? [`${label} · 심판 회차 폐기: ${verdict.discardReasons.join(' / ')} · 원고: ${draftsDir}`]
      : []),
    ...(verdict.floor.passed
      ? []
      : [
          `${label} · 하한선 관문 실패 (회차는 유지): ${[...verdict.floor.failures, ...verdict.floor.abstained].join(' / ')}`,
        ]),
    ...(verdict.genreProblems.length > 0
      ? [`${label} · 장르 독자 중단 (회차는 유지): ${verdict.genreProblems.join(' / ')}`]
      : []),
  ];
}

async function scoreRecall(
  input: ChainJudgement,
  ledger: NonNullable<JudgeMaterials['ledger']>,
  judge: SimJudge,
): Promise<Partial<RunRecord>> {
  const recall: FactRecallReport = await scoreFactRecall({
    ledger,
    draftsByScene: input.drafts,
    judge: createFactRecallJudge(judge),
  });

  return {
    recalled: recall.recalled,
    recallTotal: recall.total,
    contradicted: recall.contradicted,
  };
}

export class SimRunJudging {
  public constructor(private readonly deps: SimRunJudgingDependencies) {}

  public async judgeKeptDrafts(request: KeptDraftsJudgement): Promise<Partial<RunRecord>> {
    const { source } = request;
    const generation: Selection = {
      providerId: source.run.generation.providerId as AiProviderId,
      model: source.run.generation.model,
    };

    try {
      return await this.judgeChainDrafts({
        judge: request.judge,
        generation,
        materials: request.materials,
        scenes: request.scenes,
        drafts: request.drafts,
        label: `${source.run.runId} 재채점`,
        draftsDir: source.draftsDir,
      });
    } catch (error) {
      const message: string = extractErrorMessage(error);
      this.deps.logger.warn(`${source.run.runId} · 심판 실패: ${message}`);
      return { discarded: true, discardReasons: [`심판 실패: ${message}`] };
    }
  }

  public async judgeRepeat(request: RepeatJudgement): Promise<Partial<RunRecord>> {
    const { judge, materials } = request;

    try {
      if (judge !== undefined && materials?.axisFloors !== undefined) {
        return await this.judgeAxisDrafts(request, judge, materials.axisFloors);
      }
      if (judge !== undefined && materials !== undefined) {
        return await this.judgeChainDrafts({ ...request, judge, materials });
      }
      return {};
    } catch (error) {
      const message: string = extractErrorMessage(error);
      this.deps.logger.warn(`${request.label} · 심판 실패, 생성 결과만 남깁니다: ${message}`);
      return { discarded: true, discardReasons: [`심판 실패: ${message}`] };
    }
  }

  private async judgeAxisDrafts(
    request: DraftJudgement,
    selection: Selection,
    axisFloors: ReadonlyMap<string, string>,
  ): Promise<Partial<RunRecord>> {
    const judge: SimJudge = createSimJudge({
      registry: this.deps.registry,
      judge: selection,
      generation: request.generation,
    });
    const verdicts: readonly AxisVerdict[] = await judgeAxis({
      judge,
      scenes: createAxisScenes(request.scenes, request.drafts, axisFloors),
    });

    for (const verdict of verdicts) {
      this.deps.logger.info(describeAxisVerdict(verdict));
    }

    return { axisVerdicts: verdicts } as Partial<RunRecord>;
  }

  private async judgeChainDrafts(input: ChainJudgement): Promise<Partial<RunRecord>> {
    const judge: SimJudge = createSimJudge({
      registry: this.deps.registry,
      judge: input.judge,
      generation: input.generation,
    });
    const generatedForFloor: string | undefined = input.drafts.get(
      input.materials.floorDraft.sceneStem,
    );
    const verdict: PanelVerdict = await judgeChain({
      judge,
      scenes: orderChainDrafts(input),
      genre: input.materials.genre,
      floorCandidates: [
        { kind: 'generated', draft: generatedForFloor ?? '' },
        { kind: 'floor', draft: input.materials.floorDraft.text },
      ],
      critic: { names: input.materials.characterNames },
    });

    let fields: Partial<RunRecord> = createPanelVerdictFields(verdict);

    if (verdict.critic !== undefined && !verdict.critic.gate.passed) {
      this.deps.logger.warn(
        `${input.label} · 비평 관문 실패 (회차는 유지): ${verdict.critic.gate.reason}`,
      );
    }

    if (input.materials.ledger !== undefined && !verdict.discarded) {
      fields = { ...fields, ...(await scoreRecall(input, input.materials.ledger, judge)) };
    }

    for (const problem of describeKeptVerdictProblems(input.label, input.draftsDir, verdict)) {
      this.deps.logger.warn(problem);
    }

    return { ...fields, judgeTokens: judgeUsageTotals(judge) };
  }
}
