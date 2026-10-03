import { vscodeFileSystem } from '@/infrastructure/vscode/vscodeFileSystem';
import type { StoryboardRpcHandlers } from '@/presentation/messaging/bridge';
import type {
  StoryboardRequestPayload,
  StoryboardResponsePayload,
  NarratorCard,
  ProjectSetting,
  StoryboardProject,
  StoryUri,
} from '@storyboard/story-model';
import {
  contractFieldKeys,
  serializeNarratorCard,
  joinStoryPath,
  describeNarration,
  validateGenerationContract,
  getStoryboardProjectPaths,
} from '@storyboard/story-model';
import {
  buildCompositionPreset,
  loadNarratorCards,
  type CompositionPreset,
} from '@storyboard/story-engine';
import { resolveStoryboardWorkspaceRoot } from '@/infrastructure/vscode/workspace';
import { readProjectJson, writeProjectJson } from '@storyboard/story-engine';

type ProjectContractSnapshot = StoryboardResponsePayload<'project.readContract'>;

export function createContractRpcHandlers(): StoryboardRpcHandlers {
  return {
    'project.readContract': async (): Promise<StoryboardResponsePayload<'project.readContract'>> =>
      readContractSnapshot(),

    'project.updateContract': async (
      payload,
    ): Promise<StoryboardResponsePayload<'project.updateContract'>> => updateContract(payload),
  };
}

async function readContractSnapshot(): Promise<ProjectContractSnapshot> {
  const root = await resolveStoryboardWorkspaceRoot();
  if (!root) {
    return notAProjectSnapshot();
  }

  const project = await readProjectJson(
    vscodeFileSystem,
    getStoryboardProjectPaths(root).projectJson,
  );
  return buildSnapshot(project, await readNarratorSummaries(root));
}

// 서술자 카드는 계약 탭에서 읽기만 한다. 만들고 고치는 자리는 카드 에디터다.
async function readNarratorSummaries(
  root: StoryUri,
): Promise<{ id: string; name: string; summary: string }[]> {
  const narrators = await loadNarratorCards(getStoryboardProjectPaths(root), vscodeFileSystem);

  return [...narrators.values()].map((card) => ({
    id: card.id,
    name: card.name,
    summary: describeNarration({
      person: card.person,
      knowledge: card.knowledge,
      ...(card.focal === undefined ? {} : { focal: card.focal }),
      tense: card.tense ?? 'past',
    }),
  }));
}

async function updateContract(
  payload: StoryboardRequestPayload<'project.updateContract'>,
): Promise<ProjectContractSnapshot> {
  const root = await resolveStoryboardWorkspaceRoot();
  if (!root) {
    return notAProjectSnapshot();
  }

  const paths = getStoryboardProjectPaths(root);
  const project = await readProjectJson(vscodeFileSystem, paths.projectJson);
  const preset =
    payload.composition == null
      ? undefined
      : buildCompositionPreset({
          composition: payload.composition,
          ...(payload.episodeCount === undefined ? {} : { episodeCount: payload.episodeCount }),
          ...(payload.povCharacters && payload.povCharacters.length > 0
            ? { povCharacters: payload.povCharacters }
            : {}),
          ...(payload.pov == null ? {} : { pov: payload.pov }),
        });
  const nextProject: StoryboardProject = {
    ...project,
    setting: mergeContractSetting(project.setting, payload, preset),
  };

  await writeProjectJson(vscodeFileSystem, paths.projectJson, nextProject);
  await writePresetNarrators(paths.narratorDirectory, preset?.narratorCards ?? []);

  return buildSnapshot(nextProject, await readNarratorSummaries(root));
}

// 이미 있는 서술자는 손대지 않는다. 구성을 다시 고른다고 작가가 고친 목소리를 잃으면 안 된다.
async function writePresetNarrators(
  narratorDirectory: StoryUri,
  cards: readonly NarratorCard[],
): Promise<void> {
  if (cards.length === 0) {
    return;
  }

  await vscodeFileSystem.createDirectory(narratorDirectory);

  for (const card of cards) {
    const uri = joinStoryPath(narratorDirectory, `${card.id}.card`);

    if (!(await vscodeFileSystem.exists(uri))) {
      await vscodeFileSystem.writeFile(uri, new TextEncoder().encode(serializeNarratorCard(card)));
    }
  }
}

function buildSnapshot(
  project: StoryboardProject,
  narrators: readonly { id: string; name: string; summary: string }[],
): ProjectContractSnapshot {
  return {
    isStoryboardProject: true,
    format: project.format,
    setting: toContractSetting(project.setting, narrators),
    readiness: validateGenerationContract(project.setting),
  };
}

function notAProjectSnapshot(): ProjectContractSnapshot {
  return {
    isStoryboardProject: false,
    readiness: { isReady: false, missing: [...contractFieldKeys], warnings: [] },
  };
}

function toContractSetting(
  setting: ProjectSetting | undefined,
  narrators: readonly { id: string; name: string; summary: string }[],
): NonNullable<ProjectContractSnapshot['setting']> {
  return {
    genre: setting?.genre,
    audience: setting?.audience,
    pov: setting?.pov,
    composition: setting?.composition,
    threads: Object.entries(setting?.threads ?? {}).map(([id, thread]) => ({
      id,
      title: thread.title,
      ...(thread.wraps === undefined ? {} : { wraps: [...thread.wraps] }),
    })),
    narrators: [...narrators],
    targetWordCount: setting?.targetWordCount,
    prohibitions: setting?.prohibitions ?? [],
    styleConstraints: setting?.styleConstraints ?? [],
    qualityCriteria: setting?.qualityCriteria ?? [],
  };
}

function mergeContractSetting(
  existing: ProjectSetting | undefined,
  payload: StoryboardRequestPayload<'project.updateContract'>,
  preset: CompositionPreset | undefined,
): ProjectSetting {
  const base: ProjectSetting = existing ?? {
    tags: [],
    prohibitions: [],
    styleConstraints: [],
    qualityCriteria: [],
  };

  return {
    ...base,
    genre: normalizeText(payload.genre),
    audience: normalizeText(payload.audience),
    pov: payload.pov ?? undefined,
    targetWordCount: payload.targetWordCount ?? undefined,
    prohibitions: normalizeList(payload.prohibitions),
    styleConstraints: normalizeList(payload.styleConstraints),
    qualityCriteria: normalizeList(payload.qualityCriteria),
    ...(preset?.setting ?? {}),
  };
}

function normalizeText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

function normalizeList(values: readonly string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter((value) => value.length > 0);
}
