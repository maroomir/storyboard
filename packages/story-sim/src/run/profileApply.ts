import { readFile, writeFile } from 'node:fs/promises';

import { findKnob } from '#sim/knobs/knobRegistry';
import type { RunRecord } from '#sim/run/runStore';
import { median } from '#sim/sweep/pareto';
import type { SceneMetrics } from '#sim/score/deterministic';

export interface ProfileFields {
  readonly fields: Record<string, unknown>;
  readonly unsupported: readonly string[];
}

export function profileFieldsFor(knobs: Readonly<Record<string, number>>): ProfileFields {
  const fields: Record<string, unknown> = {};
  const unsupported: string[] = [];

  for (const [id, value] of Object.entries(knobs)) {
    if (findKnob(id)?.applyTarget !== 'modelProfile') {
      unsupported.push(id);
      continue;
    }

    fields[id] = value;
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
  const scenes: SceneMetrics[] = run.scenes.filter((scene) => scene.reach > 0);
  return scenes.length === 0 ? 0 : scenes.reduce((sum, scene) => sum + scene.reach, 0) / scenes.length;
}

export function measurementFor(
  judged: readonly RunRecord[],
  input: { readonly date: string; readonly judge?: string },
): ProfileMeasurement {
  const first: RunRecord = judged[0] as RunRecord;
  const aucs: number[] = judged.map((run) => run.auc).filter((auc): auc is number => auc !== undefined);
  const recalled: number[] = judged
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
  const raw: Record<string, unknown> = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;
  const previous: unknown = raw[key];
  const profile: Record<string, unknown> = { ...(typeof previous === 'object' && previous !== null ? previous : {}), ...fields, measured };

  if (previous !== undefined && options.force !== true) {
    return { written: false, previous, profile };
  }

  await writeFile(filePath, `${JSON.stringify({ ...raw, [key]: profile }, null, 2)}\n`, 'utf8');
  return { written: true, ...(previous === undefined ? {} : { previous }), profile };
}
