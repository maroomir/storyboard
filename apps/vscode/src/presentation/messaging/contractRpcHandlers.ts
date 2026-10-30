import type * as vscode from 'vscode';
import type { StoryboardRpcHandlers } from '@/presentation/messaging/bridge';
import type {
  StoryboardRequestPayload,
  StoryboardResponsePayload,
  NarratorCard,
  ProjectSetting,
  StoryboardProject,
} from '@storyboard/story-model';
import {
  contractFieldKeys,
  describeNarration,
  validateGenerationContract,
} from '@storyboard/story-model';
import {
  buildCompositionPreset,
  type CompositionPreset,
  type UpdateProjectContractResult,
} from '@storyboard/story-engine';
import type { CardManager, ProjectManager } from '@storyboard/story-app';
import { resolveStoryboardWorkspaceRoot } from '@/infrastructure/vscode/workspace';

type ProjectContractSnapshot = StoryboardResponsePayload<'project.readContract'>;

type NarratorSummary = { id: string; name: string; summary: string };

export interface ContractRpcDependencies {
  readonly project: Pick<ProjectManager, 'read' | 'updateContract'>;
  readonly cards: Pick<CardManager, 'listNarrators'>;
}

export class ContractRpc {
  public constructor(private readonly dependencies: ContractRpcDependencies) {}

  public handlers(): StoryboardRpcHandlers {
    return {
      'project.readContract': async (): Promise<
        StoryboardResponsePayload<'project.readContract'>
      > => this.readContractSnapshot(),

      'project.updateContract': async (
        payload,
      ): Promise<StoryboardResponsePayload<'project.updateContract'>> =>
        this.updateContract(payload),
    };
  }

  private async readContractSnapshot(): Promise<ProjectContractSnapshot> {
    const root: vscode.Uri | undefined = await resolveStoryboardWorkspaceRoot();
    if (!root) {
      return notAProjectSnapshot();
    }

    const project: StoryboardProject = await this.dependencies.project.read(root);
    return buildSnapshot(project, await this.readNarratorSummaries(root));
  }

  private async readNarratorSummaries(root: vscode.Uri): Promise<NarratorSummary[]> {
    const narrators: ReadonlyMap<string, NarratorCard> =
      await this.dependencies.cards.listNarrators(root);

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

  private async updateContract(
    payload: StoryboardRequestPayload<'project.updateContract'>,
  ): Promise<ProjectContractSnapshot> {
    const root: vscode.Uri | undefined = await resolveStoryboardWorkspaceRoot();
    if (!root) {
      return notAProjectSnapshot();
    }

    const preset: CompositionPreset | undefined = buildPresetFrom(payload);
    const updated: UpdateProjectContractResult = await this.dependencies.project.updateContract({
      workspaceRoot: root,
      setting: buildContractPatch(payload, preset),
      narratorCards: preset?.narratorCards ?? [],
    });

    if (!updated.ok) {
      throw new Error(updated.message);
    }

    const project: StoryboardProject = await this.dependencies.project.read(root);
    return buildSnapshot(project, await this.readNarratorSummaries(root));
  }
}

function buildPresetFrom(
  payload: StoryboardRequestPayload<'project.updateContract'>,
): CompositionPreset | undefined {
  return payload.composition == null
    ? undefined
    : buildCompositionPreset({
        composition: payload.composition,
        ...(payload.episodeCount === undefined ? {} : { episodeCount: payload.episodeCount }),
        ...(payload.povCharacters && payload.povCharacters.length > 0
          ? { povCharacters: payload.povCharacters }
          : {}),
        ...(payload.pov == null ? {} : { pov: payload.pov }),
      });
}

function buildSnapshot(
  project: StoryboardProject,
  narrators: readonly NarratorSummary[],
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
  narrators: readonly NarratorSummary[],
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

function buildContractPatch(
  payload: StoryboardRequestPayload<'project.updateContract'>,
  preset: CompositionPreset | undefined,
): Partial<ProjectSetting> {
  return {
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
