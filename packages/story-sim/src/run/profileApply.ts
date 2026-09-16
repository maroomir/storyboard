import { readFile, writeFile } from 'node:fs/promises';

import { findKnob, sectionOutputLimitKnobId } from '#sim/knobs/knobRegistry';
import type { RunRecord } from '#sim/run/runStore';
import { median } from '#sim/sweep/pareto';

// NOTE: 실측값이 들어가는 곳은 엔진의 modelProfiles.params.json 이다. 사람이 손으로 옮기면 어느
// 실행에서 온 값인지 반년 뒤에 아무도 모르므로, 여기서 손잡이 → 프로필 칸을 기계적으로 옮기고
// 출처(날짜·트랙·회차·도달률·AUC)를 measured 에 함께 적는다. 이미 있는 프로필은 --force 없이
// 덮어쓰지 않는다 — 몇 시간짜리 실행 끝에 사람이 자리를 비운 사이 나쁜 숫자가 들어가면 안 된다.

export interface ProfileFields {
  readonly fields: Record<string, unknown>;
  readonly unsupported: readonly string[];
}

export function profileFieldsFor(knobs: Readonly<Record<string, number>>): ProfileFields {
  const fields: Record<string, unknown> = {};
  const weights: Record<string, number> = {};
  const unsupported: string[] = [];

  for (const [id, value] of Object.entries(knobs)) {
    const knob = findKnob(id);

    if (knob === undefined || knob.applyTarget !== 'modelProfile') {
      unsupported.push(id);
      continue;
    }

    if (id === sectionOutputLimitKnobId) {
      fields['sectionOutputLimit'] = value;
    } else if (knob.weightKind !== undefined) {
      weights[knob.weightKind] = value;
    } else if (knob.tuningKey !== undefined) {
      fields[knob.tuningKey] = value;
    } else {
      unsupported.push(id);
    }
  }

  if (Object.keys(weights).length > 0) {
    fields['violationWeights'] = weights;
  }

  return { fields, unsupported };
}

export interface ProfileMeasurement {
  readonly date: string;
  readonly workspace: string;
  readonly sceneTarget: number;
  readonly runs: number;
  readonly reach: number;
  readonly auc?: number;
  readonly recalled?: number;
  readonly judge?: string;
}

function meanReach(run: RunRecord): number {
  const scenes = run.scenes.filter((scene) => scene.reach > 0);
  return scenes.length === 0 ? 0 : scenes.reduce((sum, scene) => sum + scene.reach, 0) / scenes.length;
}

// 유효 회차만 받는다. 어느 트랙에서 잰 값인지 남겨야 트랙이 바뀌었을 때 «다시 재야 할 항목» 을 가린다.
export function measurementFor(
  judged: readonly RunRecord[],
  input: { readonly date: string; readonly judge?: string },
): ProfileMeasurement {
  const first = judged[0] as RunRecord;
  const aucs = judged.map((run) => run.auc).filter((auc): auc is number => auc !== undefined);
  const recalled = judged
    .map((run) => run.recalled)
    .filter((count): count is number => count !== undefined);

  return {
    date: input.date,
    workspace: `${first.genre}@${first.trackCommit.slice(0, 7)}`,
    sceneTarget: Math.round(median(first.scenes.map((scene) => scene.targetLength))) || 1,
    runs: judged.length,
    reach: Number(median(judged.map(meanReach)).toFixed(3)),
    ...(aucs.length === 0 ? {} : { auc: Number(median(aucs).toFixed(3)) }),
    ...(recalled.length === 0 ? {} : { recalled: median(recalled) }),
    ...(input.judge === undefined ? {} : { judge: input.judge }),
  };
}

export interface ProfileWriteResult {
  readonly written: boolean;
  readonly previous?: unknown;
  readonly profile: Record<string, unknown>;
}

export async function writeModelProfile(
  filePath: string,
  key: string,
  fields: Record<string, unknown>,
  measured: ProfileMeasurement,
  options: { readonly force?: boolean } = {},
): Promise<ProfileWriteResult> {
  const raw = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;
  const previous = raw[key];
  const profile = { ...(typeof previous === 'object' && previous !== null ? previous : {}), ...fields, measured };

  if (previous !== undefined && options.force !== true) {
    return { written: false, previous, profile };
  }

  await writeFile(filePath, `${JSON.stringify({ ...raw, [key]: profile }, null, 2)}\n`, 'utf8');
  return { written: true, ...(previous === undefined ? {} : { previous }), profile };
}
