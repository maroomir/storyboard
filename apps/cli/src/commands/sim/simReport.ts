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
  type ProfileMeasurement,
  type ProfileWriteResult,
  type RunRecord,
  type ScoredPoint,
} from '@storyboard/story-sim';
import { flagBoolean, flagString } from '@/cliArguments';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import { failure, success } from '@/commands/outcomes';
import { findModelProfilesFile, scoreKey } from './simTrack';
import { regressionLines } from '@/commands/sim/simTrack';

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

    const totalUsd: number | undefined = runs.reduce<number | undefined>(
      (total, run) =>
        total === undefined || run.tokens.costUsd === undefined
          ? undefined
          : total + run.tokens.costUsd,
      0,
    );
    const axis: CostAxis = chooseCostAxis(totalUsd);
    const scored: readonly PointScore[] = scoreRuns(runs, axis);
    const frontier: readonly ScoredPoint[] = paretoFrontier(
      scored.filter((point) => point.judged > 0),
    );
    const frontierKeys: Set<string> = new Set(
      frontier.map((point) => scoreKey(point as PointScore)),
    );
    const judgedRuns: number = scored.reduce((total, point) => total + point.judged, 0);

    const fingerprints: Set<string> = new Set(
      scored.map((point) => `${point.engineCommit}@${point.trackCommit}`),
    );
    const mixed: boolean = fingerprints.size > 1;
    const generations: Set<string> = new Set(scored.map((point) => point.generation));
    const mixedGeneration: boolean = generations.size > 1;
    const judges: Set<string> = new Set(scored.map((point) => point.judge));
    const mixedJudge: boolean = judges.size > 1;

    const genres: string[] = [...new Set(scored.map((point) => point.genre))].sort();
    const lines: string[] = genres.flatMap((genre) => [
      '',
      `[${genre}]`,
      ...scored
        .filter((point) => point.genre === genre)
        .map((point) => {
          const mark: ' ' | '*' = frontierKeys.has(scoreKey(point)) ? '*' : ' ';
          const cost: string =
            axis === 'usd' ? `$${point.cost.toFixed(4)}` : point.cost.toLocaleString();
          const name: string =
            (mixed
              ? `${point.pointLabel} @${point.engineCommit.slice(0, 7)}/${point.trackCommit.slice(0, 7)}`
              : point.pointLabel) +
            (mixedGeneration ? ` [${point.generation}]` : '') +
            (mixedJudge && point.judge.length > 0 ? ` 심판:${point.judge}` : '');
          const engagement: string =
            point.engagement === undefined ? '' : ` 몰입 ${point.engagement.toFixed(2)}`;
          const quality: string =
            point.judged === 0
              ? `AUC n/a\t${cost}\t회수 n/a`
              : `AUC ${point.auc.toFixed(3)}${engagement}\t${cost}\t회수 ${point.recalled}`;
          const critic: string =
            point.critic === undefined
              ? ''
              : `\t비평 ${point.critic.grounded}/20 의견 ${point.critic.opinion}/10 비평관문 ${point.critic.gatePassed}/${point.critic.runs}`;
          const judgeCost: string =
            point.judgeCostUsd === undefined || point.judgeCostUsd === 0
              ? ''
              : `\t심판 ${formatUsd(point.judgeCostUsd)}`;
          return `${mark} ${name}\t${quality}\t유효 ${point.judged}/${point.runs}\t관문 ${point.gatePassed}/${point.judged}${critic}${judgeCost}`;
        }),
    ]);

    return success(
      [
        `실행 ${runs.length}회 (유효 ${judgedRuns}회) · 지점 ${scored.length}개 · 시험체 ${genres.length}개 (* 는 그 시험체의 파레토 경계)`,
        `비용 축: ${costAxisLabels[axis]}`,
        '품질 축은 유효 회차의 중앙값, 비용 축은 전체 회차의 중앙값 · 관문은 유효 회차 중 심판이 훼손본을 가려낸 수',
        ...(mixed ? ['엔진·트랙이 다른 기록은 따로 셉니다 (@엔진/트랙)'] : []),
        ...(mixedGeneration
          ? ['생성 모델·프롬프트 변형이 다른 기록은 따로 셉니다 ([프로바이더:모델/변형])']
          : []),
        'ceiling: n/a',
        ...lines,
        ...regressionLines(runs),
      ].join('\n'),
      { runs: runs.length, costAxis: axis, points: scored, frontier },
    );
  }

  public async apply(): Promise<CommandOutcome> {
    const outPath: string | undefined = this.flag('out');
    const point: string | undefined = this.flag('point');

    if (outPath === undefined || point === undefined) {
      return failure('--out 과 --point 를 모두 지정해 주세요.');
    }

    const runs: RunRecord[] = (await readRuns(outPath)).filter((run) => run.pointLabel === point);
    const judged: RunRecord[] = runs.filter(isJudged);

    if (runs.length === 0) {
      return failure(`${point} 의 실행 기록이 없습니다.`);
    }

    if (judged.length < simDefaults.run.repeats) {
      return failure(
        `${point} 은 유효 회차가 ${judged.length}회뿐입니다 (${runs.length}회 실행). 씨앗이 없어 회차마다 흔들리므로 ${simDefaults.run.repeats}회 이상의 중앙값이 필요합니다.`,
      );
    }

    const knobs: Readonly<Record<string, number>> = runs[0]?.knobs ?? {};
    const wrongTarget: string[] = Object.keys(knobs).filter(
      (id) => findKnob(id)?.applyTarget !== 'modelProfile',
    );

    if (wrongTarget.length > 0) {
      return failure(
        [
          '모델 프로필에 적을 수 없는 손잡이가 있습니다:',
          ...wrongTarget.map((id) => `  ${id} → ${findKnob(id)?.applyTarget ?? '알 수 없음'}`),
          '한 모델에서만 잰 값은 공유 기본값이 아니라 모델 프로필에 들어갑니다.',
        ].join('\n'),
      );
    }

    const { fields, unsupported } = profileFieldsFor(knobs);

    if (unsupported.length > 0) {
      return failure(`프로필 칸으로 옮길 수 없는 손잡이가 있습니다: ${unsupported.join(', ')}`);
    }

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

    if (flagBoolean(this.context.args.flags, 'dry-run')) {
      return success(['적지 않고 계획만 보여 줍니다.', ...plan].join('\n'), {
        point,
        key,
        fields,
        measured,
        runs: runs.length,
        judged: judged.length,
      });
    }

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

    return success(
      [
        ...plan,
        `적었습니다: ${profilesPath}`,
        '검토 후 커밋하세요. 이 파일은 엔진 소스입니다.',
      ].join('\n'),
      {
        point,
        key,
        fields,
        measured,
        file: profilesPath,
        runs: runs.length,
        judged: judged.length,
      },
    );
  }

  private flag(name: string): string | undefined {
    return flagString(this.context.args.flags, name);
  }
}
