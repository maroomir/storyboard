import type { StoryboardRpcHandlers } from '@/presentation/messaging/bridge';
import type { StoryboardRequestPayload, StoryboardResponsePayload } from '@/shared/messaging';
import { contractFieldKeys } from '@seedkernel/wasm';
import type { ProjectSetting, StoryboardProject } from '@seedkernel/wasm';
import { validateGenerationContract } from '@/domain/generationContract';
import { getStoryboardProjectPaths } from '@/infrastructure/vscode/pathConventions';
import { resolveStoryboardWorkspaceRoot } from '@/infrastructure/vscode/workspace';
import { readProjectJson, writeProjectJson } from '@/infrastructure/persistence/projectJson';

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

  const project = await readProjectJson(getStoryboardProjectPaths(root).projectJson);
  return buildSnapshot(project);
}

async function updateContract(
  payload: StoryboardRequestPayload<'project.updateContract'>,
): Promise<ProjectContractSnapshot> {
  const root = await resolveStoryboardWorkspaceRoot();
  if (!root) {
    return notAProjectSnapshot();
  }

  const projectJsonUri = getStoryboardProjectPaths(root).projectJson;
  const project = await readProjectJson(projectJsonUri);
  const nextProject: StoryboardProject = {
    ...project,
    setting: mergeContractSetting(project.setting, payload),
  };

  await writeProjectJson(projectJsonUri, nextProject);
  return buildSnapshot(nextProject);
}

function buildSnapshot(project: StoryboardProject): ProjectContractSnapshot {
  return {
    isStoryboardProject: true,
    format: project.format,
    setting: toContractSetting(project.setting),
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
): NonNullable<ProjectContractSnapshot['setting']> {
  return {
    genre: setting?.genre,
    audience: setting?.audience,
    pov: setting?.pov,
    targetWordCount: setting?.targetWordCount,
    prohibitions: setting?.prohibitions ?? [],
    styleConstraints: setting?.styleConstraints ?? [],
    qualityCriteria: setting?.qualityCriteria ?? [],
  };
}

function mergeContractSetting(
  existing: ProjectSetting | undefined,
  payload: StoryboardRequestPayload<'project.updateContract'>,
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
  };
}

function normalizeText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

function normalizeList(values: readonly string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter((value) => value.length > 0);
}
