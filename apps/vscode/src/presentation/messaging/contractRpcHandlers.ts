import type * as vscode from 'vscode';
import { vscodeFileSystem } from '@/infrastructure/vscode/vscodeFileSystem';
import type { StoryboardRpcHandlers } from '@/presentation/messaging/bridge';
import type {
  StoryboardRequestPayload,
  StoryboardResponsePayload,
  NarratorCard,
  ProjectSetting,
  StoryboardProject,
  StoryUri,
  StoryboardProjectPaths,
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
  const root: vscode.Uri | undefined = await resolveStoryboardWorkspaceRoot();
  if (!root) {
    return notAProjectSnapshot();
  }

  const project: StoryboardProject = await readProjectJson(
    vscodeFileSystem,
    getStoryboardProjectPaths(root).projectJson,
  );
  return buildSnapshot(project, await readNarratorSummaries(root));
}

async function readNarratorSummaries(
  root: StoryUri,
): Promise<{ id: string; name: string; summary: string }[]> {
  const narrators: ReadonlyMap<string, NarratorCard> = await loadNarratorCards(
    getStoryboardProjectPaths(root),
    vscodeFileSystem,
  );

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
  const root: vscode.Uri | undefined = await resolveStoryboardWorkspaceRoot();
  if (!root) {
    return notAProjectSnapshot();
  }

  const paths: StoryboardProjectPaths = getStoryboardProjectPaths(root);
  const project: StoryboardProject = await readProjectJson(vscodeFileSystem, paths.projectJson);
  const preset: CompositionPreset | undefined =
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

async function writePresetNarrators(
  narratorDirectory: StoryUri,
  cards: readonly NarratorCard[],
): Promise<void> {
  if (cards.length === 0) {
    return;
  }

  await vscodeFileSystem.createDirectory(narratorDirectory);

  for (const card of cards) {
    const uri: StoryUri = joinStoryPath(narratorDirectory, `${card.id}.card`);

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
  const trimmed: string | undefined = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

function normalizeList(values: readonly string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter((value) => value.length > 0);
}
