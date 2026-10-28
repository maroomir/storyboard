import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { parseSceneCard, parseSceneFileName } from '@storyboard/story-model';
import type { AiProviderId, SceneCard, SceneFileNameParts } from '@storyboard/story-model';
import type { PromptVariantId } from '@storyboard/story-ai';
import {
  applyOverlay,
  describeRegression,
  parseFactLedger,
  parseOverlay,
  regressionRows,
  summarizeUsage,
  type Overlay,
  type PointScore,
  type RegressionRow,
  type RunRecord,
  type SimConfig,
  type SimJudge,
  type TokenTotals,
} from '@storyboard/story-sim';

export interface TrackScene {
  readonly sceneStem: string;
  readonly targetLength: number;
  readonly title: string;
  readonly purpose: string;
}

export interface JudgeMaterials {
  readonly genre: string;
  readonly characterNames: readonly string[];
  readonly floorDraft: { readonly sceneStem: string; readonly text: string };
  readonly ledger: ReturnType<typeof parseFactLedger> | undefined;
  readonly axisFloors?: ReadonlyMap<string, string>;
}

export interface OverlayPoint {
  readonly label: string;
  readonly knobs: Record<string, number>;
  readonly refusals: readonly string[];
}

export interface Selection {
  readonly providerId: AiProviderId;
  readonly model: string;
  readonly promptVariant?: PromptVariantId;
}

const axisGenre: string = 'axis';

export async function readTrackScenes(genreRoot: string): Promise<readonly TrackScene[]> {
  const sceneDirectory: string = join(genreRoot, 'scene');
  const names: string[] = (await readdir(sceneDirectory)).filter((name) =>
    parseSceneFileName(name),
  );
  const scenes: TrackScene[] = [];

  for (const name of names.sort()) {
    const parts: SceneFileNameParts | undefined = parseSceneFileName(name);
    const card: SceneCard = parseSceneCard(await readFile(join(sceneDirectory, name), 'utf8'));

    if (parts === undefined) {
      continue;
    }

    if (card.targetWordCount === undefined) {
      throw new Error(
        `${name} 에 targetWordCount 가 없습니다. 트랙 카드는 목표 분량을 적어야 합니다.`,
      );
    }

    scenes.push({
      sceneStem: parts.stem,
      targetLength: card.targetWordCount,
      title: card.title ?? parts.stem,
      purpose: card.purpose ?? '',
    });
  }

  if (scenes.length === 0) {
    throw new Error(`${sceneDirectory} 에 씬 카드가 없습니다.`);
  }

  return scenes;
}

export async function readAxisFloors(
  genreRoot: string,
  scenes: readonly TrackScene[],
): Promise<ReadonlyMap<string, string>> {
  const floors: Map<string, string> = new Map<string, string>();
  for (const scene of scenes) {
    try {
      floors.set(
        scene.sceneStem,
        await readFile(join(genreRoot, 'floor', `${scene.sceneStem}.md`), 'utf8'),
      );
    } catch {
      continue;
    }
  }
  return floors;
}

export async function readCharacterNames(genreRoot: string): Promise<readonly string[]> {
  const directory: string = join(genreRoot, 'character');
  let files: string[];

  try {
    files = (await readdir(directory)).filter((name) => name.endsWith('.card')).sort();
  } catch {
    return [];
  }

  const names: string[] = [];
  for (const file of files) {
    const text: string = await readFile(join(directory, file), 'utf8');
    const match: RegExpExecArray | null = /^name:\s*(.+)$/mu.exec(text);
    if (match !== null) {
      names.push((match[1] as string).trim());
    }
  }

  return names;
}

export async function readJudgeMaterials(
  genreRoot: string,
  genre: string,
  scenes: readonly TrackScene[],
): Promise<JudgeMaterials | string> {
  if (genre === axisGenre) {
    const floors: ReadonlyMap<string, string> = await readAxisFloors(genreRoot, scenes);
    if (floors.size !== scenes.length) {
      return `${join(genreRoot, 'floor')} 에 씬마다 훼손 원고가 있어야 합니다 (${floors.size}/${scenes.length}).`;
    }
    return {
      genre,
      characterNames: [],
      floorDraft: { sceneStem: '', text: '' },
      ledger: undefined,
      axisFloors: floors,
    };
  }

  let floorDraft: JudgeMaterials['floorDraft'] | undefined;

  for (const scene of scenes) {
    try {
      const text: string = await readFile(
        join(genreRoot, 'floor', `${scene.sceneStem}.md`),
        'utf8',
      );
      floorDraft = { sceneStem: scene.sceneStem, text };
      break;
    } catch {
      continue;
    }
  }

  if (floorDraft === undefined) {
    return `${join(genreRoot, 'floor')} 에 훼손 원고가 없습니다. 하한선 관문 없이는 심판을 믿을 수 없어 시작하지 않습니다.`;
  }

  const characterNames: readonly string[] = await readCharacterNames(genreRoot);

  let ledger: JudgeMaterials['ledger'];
  try {
    ledger = parseFactLedger(await readFile(join(genreRoot, 'facts.yaml'), 'utf8'));
  } catch {
    ledger = undefined;
  }

  return { genre, characterNames, floorDraft, ledger };
}

export function resolveGenreRoot(trackRoot: string, genre: string | undefined): string {
  if (genre === axisGenre) {
    return join(trackRoot, 'track', axisGenre);
  }
  return genre === undefined ? trackRoot : join(trackRoot, 'track', 'chain', genre);
}

export async function loadOverlayPoint(
  overlayPath: string | undefined,
  provider: AiProviderId,
): Promise<OverlayPoint> {
  if (overlayPath === undefined) {
    return { label: 'point', knobs: {}, refusals: [] };
  }

  const overlay: Overlay = parseOverlay(JSON.parse(await readFile(overlayPath, 'utf8')));
  const { refusals } = applyOverlay(overlay, provider);

  return { label: overlay.label ?? 'point', knobs: overlay.knobs, refusals };
}

export async function readKeptDrafts(
  directory: string,
  scenes: readonly TrackScene[],
): Promise<Map<string, string>> {
  const drafts: Map<string, string> = new Map<string, string>();
  for (const scene of scenes) {
    try {
      drafts.set(scene.sceneStem, await readFile(join(directory, `${scene.sceneStem}.md`), 'utf8'));
    } catch {
      continue;
    }
  }
  return drafts;
}

export async function findModelProfilesFile(): Promise<string | undefined> {
  let directory: string = dirname(process.argv[1] ?? process.cwd());

  for (let depth: number = 0; depth < 6; depth += 1) {
    const candidate: string = join(
      directory,
      'packages',
      'story-ai',
      'src',
      'contracts',
      'modelProfiles.params.json',
    );
    try {
      await readFile(candidate, 'utf8');
      return candidate;
    } catch {
      directory = dirname(directory);
    }
  }

  return undefined;
}

export function generationRecord(
  selection: Selection,
  localRuntime: SimConfig['ollama'],
): RunRecord['generation'] {
  return {
    providerId: selection.providerId,
    model: selection.model,
    ...(selection.promptVariant === undefined ? {} : { promptVariant: selection.promptVariant }),
    ...(selection.providerId === 'ollama' && localRuntime?.think !== undefined
      ? { think: localRuntime.think }
      : {}),
  };
}

export function judgeUsageTotals(judge: SimJudge): TokenTotals {
  return summarizeUsage(
    judge.usage().map((response) => ({
      taskName: 'draftCritique' as const,
      providerId: response.providerId,
      model: response.model,
      ...(response.usage === undefined ? {} : { usage: response.usage }),
      ...(response.costUsd === undefined ? {} : { costUsd: response.costUsd }),
      attribution: { primary: { kind: 'scene', id: 'sim-judge' } },
    })),
  );
}

export function regressionLines(runs: readonly RunRecord[]): readonly string[] {
  const rows: readonly RegressionRow[] = regressionRows(runs);

  return rows.length === 0
    ? []
    : ['', '[회귀: 앞 엔진 대비]', ...rows.map((row) => `  ${describeRegression(row)}`)];
}

export function scoreKey(point: PointScore): string {
  return [point.genre, point.pointLabel, point.engineCommit, point.trackCommit].join('\u0000');
}
