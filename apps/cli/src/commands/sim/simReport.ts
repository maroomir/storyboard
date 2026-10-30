import { formatUsd } from '@storyboard/story-model';
import {
  chooseCostAxis,
  costAxisLabels,
  findKnob,
  isJudged,
  measurementFor,
  paretoFrontier,
  profileFieldsFor,
  readRuns,
  scoreRuns,
  simDefaults,
  writeModelProfile,
  type CostAxis,
  type PointScore,
  type ProfileFields,
  type ProfileMeasurement,
  type ProfileWriteResult,
  type RunRecord,
  type ScoredPoint,
} from '@storyboard/story-sim';
import { flagBoolean, flagString } from '@/cliArguments';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import { failure, success } from '@/commands/outcomes';
import { findModelProfilesFile, scoreKey } from '@/commands/sim/simTrack';
import { regressionLines } from '@/commands/sim/simTrack';

interface PointLineView {
  readonly axis: CostAxis;
  readonly frontierKeys: ReadonlySet<string>;
  readonly hasMixedFingerprints: boolean;
  readonly hasMixedGenerations: boolean;
  readonly hasMixedJudges: boolean;
}

interface ProfileProposal {
  readonly point: string;
  readonly key: string;
  readonly fields: Record<string, unknown>;
  readonly measured: ProfileMeasurement;
  readonly plan: readonly string[];
  readonly runs: number;
  readonly judged: number;
}

function sumCostUsd(runs: readonly RunRecord[]): number | undefined {
  return runs.reduce<number | undefined>(
    (total, run) =>
      total === undefined || run.tokens.costUsd === undefined
        ? undefined
        : total + run.tokens.costUsd,
    0,
  );
}

function createPointLineView(
  scored: readonly PointScore[],
  frontier: readonly ScoredPoint[],
  axis: CostAxis,
): PointLineView {
  const fingerprints: Set<string> = new Set(
    scored.map((point) => `${point.engineCommit}@${point.trackCommit}`),
  );
  const generations: Set<string> = new Set(scored.map((point) => point.generation));
  const judges: Set<string> = new Set(scored.map((point) => point.judge));

  return {
    axis,
    frontierKeys: new Set(frontier.map((point) => scoreKey(point as PointScore))),
    hasMixedFingerprints: fingerprints.size > 1,
    hasMixedGenerations: generations.size > 1,
    hasMixedJudges: judges.size > 1,
  };
}

function renderPointName(point: PointScore, view: PointLineView): string {
  return (
    (view.hasMixedFingerprints
      ? `${point.pointLabel} @${point.engineCommit.slice(0, 7)}/${point.trackCommit.slice(0, 7)}`
      : point.pointLabel) +
    (view.hasMixedGenerations ? ` [${point.generation}]` : '') +
    (view.hasMixedJudges && point.judge.length > 0 ? ` 심판:${point.judge}` : '')
  );
}

function renderPointQuality(point: PointScore, cost: string): string {
  const engagement: string =
    point.engagement === undefined ? '' : ` 몰입 ${point.engagement.toFixed(2)}`;

  return point.judged === 0
    ? `AUC n/a\t${cost}\t회수 n/a`
    : `AUC ${point.auc.toFixed(3)}${engagement}\t${cost}\t회수 ${point.recalled}`;
}

function renderPointLine(point: PointScore, view: PointLineView): string {
  const mark: ' ' | '*' = view.frontierKeys.has(scoreKey(point)) ? '*' : ' ';
  const cost: string =
    view.axis === 'usd' ? `$${point.cost.toFixed(4)}` : point.cost.toLocaleString();
  const critic: string =
    point.critic === undefined
      ? ''
      : `\t비평 ${point.critic.grounded}/20 의견 ${point.critic.opinion}/10 비평관문 ${point.critic.gatePassed}/${point.critic.runs}`;
  const judgeCost: string =
    point.judgeCostUsd === undefined || point.judgeCostUsd === 0
      ? ''
      : `\t심판 ${formatUsd(point.judgeCostUsd)}`;

  return `${mark} ${renderPointName(point, view)}\t${renderPointQuality(point, cost)}\t유효 ${point.judged}/${point.runs}\t관문 ${point.gatePassed}/${point.judged}${critic}${judgeCost}`;
}

function renderGenreLines(
  genres: readonly string[],
  scored: readonly PointScore[],
  view: PointLineView,
): string[] {
  return genres.flatMap((genre) => [
    '',
    `[${genre}]`,
    ...scored.filter((point) => point.genre === genre).map((point) => renderPointLine(point, view)),
  ]);
}

function renderReport(
  runs: readonly RunRecord[],
  scored: readonly PointScore[],
  view: PointLineView,
): string {
  const judgedRuns: number = scored.reduce((total, point) => total + point.judged, 0);
  const genres: string[] = [...new Set(scored.map((point) => point.genre))].sort();

  return [
    `실행 ${runs.length}회 (유효 ${judgedRuns}회) · 지점 ${scored.length}개 · 시험체 ${genres.length}개 (* 는 그 시험체의 파레토 경계)`,
    `비용 축: ${costAxisLabels[view.axis]}`,
    '품질 축은 유효 회차의 중앙값, 비용 축은 전체 회차의 중앙값 · 관문은 유효 회차 중 심판이 훼손본을 가려낸 수',
    ...(view.hasMixedFingerprints ? ['엔진·트랙이 다른 기록은 따로 셉니다 (@엔진/트랙)'] : []),
    ...(view.hasMixedGenerations
      ? ['생성 모델·프롬프트 변형이 다른 기록은 따로 셉니다 ([프로바이더:모델/변형])']
      : []),
    'ceiling: n/a',
    ...renderGenreLines(genres, scored, view),
    ...regressionLines(runs),
  ].join('\n');
}

function describeRunShortage(
  point: string,
  runs: readonly RunRecord[],
  judged: readonly RunRecord[],
): string | undefined {
  if (runs.length === 0) {
    return `${point} 의 실행 기록이 없습니다.`;
  }

  if (judged.length < simDefaults.run.repeats) {
    return `${point} 은 유효 회차가 ${judged.length}회뿐입니다 (${runs.length}회 실행). 씨앗이 없어 회차마다 흔들리므로 ${simDefaults.run.repeats}회 이상의 중앙값이 필요합니다.`;
  }

  return undefined;
}

function describeWrongTargetKnobs(knobs: Readonly<Record<string, number>>): string | undefined {
  const wrongTarget: string[] = Object.keys(knobs).filter(
    (id) => findKnob(id)?.applyTarget !== 'modelProfile',
  );

  if (wrongTarget.length === 0) {
    return undefined;
  }

  return [
    '모델 프로필에 적을 수 없는 손잡이가 있습니다:',
    ...wrongTarget.map((id) => `  ${id} → ${findKnob(id)?.applyTarget ?? '알 수 없음'}`),
    '한 모델에서만 잰 값은 공유 기본값이 아니라 모델 프로필에 들어갑니다.',
  ].join('\n');
}

function createProfileProposal(
  point: string,
  runs: readonly RunRecord[],
  judged: readonly RunRecord[],
  fields: Record<string, unknown>,
): ProfileProposal {
  const generation: RunRecord['generation'] = runs[0]?.generation as RunRecord['generation'];
  const key: string = `${generation.providerId}:${generation.model}`;
  const judge: RunRecord['judge'] = judged[0]?.judge;
  const measured: ProfileMeasurement = measurementFor(judged, {
    date: new Date().toISOString().slice(0, 10),
    ...(judge === undefined ? {} : { judge: `${judge.providerId}:${judge.model}` }),
  });
  const plan: string[] = [
    `${point} 를 ${key} 프로필에 적습니다.`,
    ...Object.entries(fields).map(([id, value]) => `  ${id} = ${JSON.stringify(value)}`),
    `  measured = ${JSON.stringify(measured)}`,
  ];

  return { point, key, fields, measured, plan, runs: runs.length, judged: judged.length };
}

function describeWrittenProfile(proposal: ProfileProposal, profilesPath: string): CommandOutcome {
  const { point, key, fields, measured, plan } = proposal;

  return success(
    [...plan, `적었습니다: ${profilesPath}`, '검토 후 커밋하세요. 이 파일은 엔진 소스입니다.'].join(
      '\n',
    ),
    {
      point,
      key,
      fields,
      measured,
      file: profilesPath,
      runs: proposal.runs,
      judged: proposal.judged,
    },
  );
}

export class SimReport {
  public constructor(private readonly context: CommandContext) {}

  public async report(): Promise<CommandOutcome> {
    const outPath: string | undefined = this.flag('out');

    if (outPath === undefined) {
      return failure('--out 으로 결과 파일을 지정해 주세요.');
    }

    const runs: readonly RunRecord[] = await readRuns(outPath);

    if (runs.length === 0) {
      return success('아직 기록된 실행이 없습니다.', { runs: [] });
    }

    const axis: CostAxis = chooseCostAxis(sumCostUsd(runs));
    const scored: readonly PointScore[] = scoreRuns(runs, axis);
    const frontier: readonly ScoredPoint[] = paretoFrontier(
      scored.filter((point) => point.judged > 0),
    );
    const view: PointLineView = createPointLineView(scored, frontier, axis);

    return success(renderReport(runs, scored, view), {
      runs: runs.length,
      costAxis: axis,
      points: scored,
      frontier,
    });
  }

  public async apply(): Promise<CommandOutcome> {
    const outPath: string | undefined = this.flag('out');
    const point: string | undefined = this.flag('point');

    if (outPath === undefined || point === undefined) {
      return failure('--out 과 --point 를 모두 지정해 주세요.');
    }

    const runs: RunRecord[] = (await readRuns(outPath)).filter((run) => run.pointLabel === point);
    const judged: RunRecord[] = runs.filter(isJudged);
    const knobs: Readonly<Record<string, number>> = runs[0]?.knobs ?? {};
    const refusal: string | undefined =
      describeRunShortage(point, runs, judged) ?? describeWrongTargetKnobs(knobs);

    if (refusal !== undefined) {
      return failure(refusal);
    }

    const { fields, unsupported }: ProfileFields = profileFieldsFor(knobs);

    if (unsupported.length > 0) {
      return failure(`프로필 칸으로 옮길 수 없는 손잡이가 있습니다: ${unsupported.join(', ')}`);
    }

    const proposal: ProfileProposal = createProfileProposal(point, runs, judged, fields);

    if (flagBoolean(this.context.args.flags, 'dry-run')) {
      return success(['적지 않고 계획만 보여 줍니다.', ...proposal.plan].join('\n'), {
        point,
        key: proposal.key,
        fields,
        measured: proposal.measured,
        runs: proposal.runs,
        judged: proposal.judged,
      });
    }

    return this.writeProfile(proposal);
  }

  private async writeProfile(proposal: ProfileProposal): Promise<CommandOutcome> {
    const { key, fields, measured } = proposal;
    const profilesPath: string | undefined =
      this.flag('profiles') ?? (await findModelProfilesFile());

    if (profilesPath === undefined) {
      return failure(
        '엔진의 modelProfiles.params.json 을 찾지 못했습니다. 저장소 안에서 돌리거나 --profiles 로 경로를 주세요.',
      );
    }

    const profileWrite: ProfileWriteResult = await writeModelProfile(
      profilesPath,
      key,
      fields,
      measured,
      {
        force: flagBoolean(this.context.args.flags, 'force'),
      },
    );

    if (!profileWrite.written) {
      return failure(
        [
          `${key} 프로필이 이미 있습니다. 덮어쓰려면 --force 를 붙이세요.`,
          `  지금 값: ${JSON.stringify(profileWrite.previous)}`,
        ].join('\n'),
      );
    }

    return describeWrittenProfile(proposal, profilesPath);
  }

  private flag(name: string): string | undefined {
    return flagString(this.context.args.flags, name);
  }
}
