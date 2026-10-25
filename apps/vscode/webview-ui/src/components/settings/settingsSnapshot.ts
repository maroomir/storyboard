import {
  aiProviderIds,
  requiresApiKey as providerRequiresApiKey,
  type AiProviderId,
  type ConfigValueOrigin,
  type StoryboardSettingKind,
} from '@storyboard/story-model/contracts';

export const AI_PROVIDER_IDS: readonly AiProviderId[] = aiProviderIds;
import { listSelectableProviderIds } from '@storyboard/story-model/contracts';
import { readPayloadFields, type PayloadFields } from '@webview/lib/payloadFields';

export function listSnapshotSelectableProviderIds(
  snapshot: SettingsReadSnapshot,
  currentProviderId?: AiProviderId,
): AiProviderId[] {
  return listSelectableProviderIds(
    currentProviderId,
    snapshot.providers.map((provider) => provider.providerId),
  );
}
export type { AiProviderId };

export type AiTaskName = string;

export type ConnectionTestState = 'idle' | 'loading' | 'ok' | 'error';

export interface AiProviderStatus {
  readonly providerId: AiProviderId;
  readonly displayName: string;
  readonly model?: string;
  readonly hasApiKey: boolean;
  readonly isAvailable: boolean;
}

interface ProviderModelOption {
  readonly id: string;
  readonly displayName: string;
}

export interface ProviderRuntimeConfig {
  readonly model: string;
  readonly baseUrl?: string;
}

export interface TaskAiAssignment {
  readonly providerId: AiProviderId | null;
  readonly model: string | null;
}

export interface TaskCatalogItem {
  readonly name: AiTaskName;
  readonly label: string;
}

export type SettingValue = boolean | number | string;

export interface SettingDefinition {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly kind: StoryboardSettingKind;
  readonly defaultValue: SettingValue;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly group: string;
}

export interface SettingsConfigFiles {
  readonly user: string;
  readonly workspace?: string;
}

export interface SettingsReadSnapshot {
  readonly defaultProvider: AiProviderId;
  readonly isDefaultProviderConfigured: boolean;
  readonly providers: readonly AiProviderStatus[];
  readonly providerConfigs: Readonly<Record<AiProviderId, ProviderRuntimeConfig>>;
  readonly taskAssignments: Readonly<Record<string, TaskAiAssignment>>;
  readonly modelCatalog: Readonly<Record<AiProviderId, readonly ProviderModelOption[]>>;
  readonly taskCatalog: readonly TaskCatalogItem[];
  readonly origins: Readonly<Record<string, ConfigValueOrigin>>;
  readonly configFiles: SettingsConfigFiles;
  readonly settingCatalog: readonly SettingDefinition[];
  readonly settingValues: Readonly<Record<string, SettingValue>>;
}

export interface SaveTarget {
  readonly origin?: ConfigValueOrigin;
  readonly file?: string;
}

export function parseSaveTarget(value: unknown): SaveTarget {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const candidate: PayloadFields = readPayloadFields(value);
  const origin: ConfigValueOrigin | undefined =
    candidate.origin === 'user' ||
    candidate.origin === 'workspace' ||
    candidate.origin === 'default'
      ? candidate.origin
      : undefined;

  return {
    ...(origin === undefined ? {} : { origin }),
    ...(typeof candidate.file === 'string' ? { file: candidate.file } : {}),
  };
}

export function originLabel(origin: ConfigValueOrigin | undefined): string {
  switch (origin) {
    case 'workspace':
      return '이 작품';
    case 'user':
      return '공통';
    default:
      return '기본값';
  }
}

export function getValueOrigin(snapshot: SettingsReadSnapshot, key: string): ConfigValueOrigin {
  return snapshot.origins[key] ?? 'default';
}

export function isAiProviderId(value: string): value is AiProviderId {
  return (AI_PROVIDER_IDS as readonly string[]).includes(value);
}

export function parseSettingsReadSnapshot(value: unknown): SettingsReadSnapshot | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate: Partial<SettingsReadSnapshot> = value as Partial<SettingsReadSnapshot>;
  if (!isAiProviderId(candidate.defaultProvider ?? '')) {
    return undefined;
  }

  if (
    !Array.isArray(candidate.providers) ||
    !candidate.providerConfigs ||
    !candidate.taskAssignments ||
    !candidate.modelCatalog ||
    !Array.isArray(candidate.taskCatalog) ||
    !candidate.origins ||
    typeof candidate.origins !== 'object' ||
    !candidate.configFiles ||
    typeof candidate.configFiles.user !== 'string' ||
    !Array.isArray(candidate.settingCatalog) ||
    !candidate.settingValues ||
    typeof candidate.settingValues !== 'object' ||
    typeof candidate.isDefaultProviderConfigured !== 'boolean'
  ) {
    return undefined;
  }

  for (const definition of candidate.settingCatalog) {
    if (
      !definition ||
      typeof definition !== 'object' ||
      typeof (definition as SettingDefinition).key !== 'string' ||
      typeof (definition as SettingDefinition).label !== 'string'
    ) {
      return undefined;
    }
  }

  for (const id of AI_PROVIDER_IDS) {
    const cfg: unknown = (candidate.providerConfigs as Record<string, unknown>)[id];
    if (!cfg || typeof cfg !== 'object' || typeof (cfg as { model?: unknown }).model !== 'string') {
      return undefined;
    }
    const models: unknown = (candidate.modelCatalog as Record<string, unknown>)[id];
    if (!Array.isArray(models) || models.length === 0) {
      return undefined;
    }
  }

  for (const taskEntry of candidate.taskCatalog) {
    if (!taskEntry || typeof taskEntry !== 'object') {
      return undefined;
    }

    const task: Record<string, unknown> = taskEntry as Record<string, unknown>;
    if (typeof task.name !== 'string' || task.name.trim().length === 0) {
      return undefined;
    }
    if (typeof task.label !== 'string' || task.label.trim().length === 0) {
      return undefined;
    }

    const taskName: string = task.name;
    const assignment: unknown = (candidate.taskAssignments as Record<string, unknown>)[taskName];
    if (!assignment || typeof assignment !== 'object') {
      return undefined;
    }

    const row: Record<string, unknown> = assignment as Record<string, unknown>;
    if (!('providerId' in row) || !('model' in row)) {
      return undefined;
    }

    const providerId: unknown = row.providerId;
    const model: unknown = row.model;
    const usesDefaultProvider: boolean = providerId === null || providerId === undefined;

    if (!usesDefaultProvider) {
      if (typeof providerId !== 'string' || !isAiProviderId(providerId)) {
        return undefined;
      }
    }

    if (model !== null && model !== undefined && typeof model !== 'string') {
      return undefined;
    }

    if (usesDefaultProvider && model !== null && model !== undefined) {
      return undefined;
    }
  }

  return candidate as SettingsReadSnapshot;
}

export function requiresApiKey(providerId: AiProviderId): boolean {
  return providerRequiresApiKey(providerId);
}

export function hasTaskOverride(snapshot: SettingsReadSnapshot, taskName: AiTaskName): boolean {
  const assignment: TaskAiAssignment | undefined = snapshot.taskAssignments[taskName];
  return assignment !== undefined && assignment.providerId !== null;
}

export function getProviderStatus(
  snapshot: SettingsReadSnapshot,
  providerId: AiProviderId,
): AiProviderStatus | undefined {
  return snapshot.providers.find((entry) => entry.providerId === providerId);
}

export function pickModelForTaskProvider(
  snapshot: SettingsReadSnapshot,
  providerId: AiProviderId,
  preferredModelId: string | null,
): string {
  const catalog: readonly ProviderModelOption[] = snapshot.modelCatalog[providerId];
  if (preferredModelId !== null && catalog.some((entry) => entry.id === preferredModelId)) {
    return preferredModelId;
  }

  const globalModel: string = snapshot.providerConfigs[providerId].model;
  if (catalog.some((entry) => entry.id === globalModel)) {
    return globalModel;
  }

  return catalog[0]?.id ?? globalModel;
}

export function formatResolvedTaskAi(snapshot: SettingsReadSnapshot, taskName: AiTaskName): string {
  const assign: TaskAiAssignment | undefined = snapshot.taskAssignments[taskName];
  let providerId: AiProviderId;
  let modelId: string;

  if (!assign || assign.providerId === null) {
    providerId = snapshot.defaultProvider;
    modelId = snapshot.providerConfigs[providerId].model;
  } else {
    providerId = assign.providerId;
    modelId = assign.model ?? snapshot.providerConfigs[providerId].model;
  }

  const providerName: string = getProviderStatus(snapshot, providerId)?.displayName ?? providerId;
  const modelLabel: string =
    snapshot.modelCatalog[providerId].find((entry) => entry.id === modelId)?.displayName ?? modelId;

  return `${providerName} / ${modelLabel}`;
}

export function formatDefaultProviderSummary(snapshot: SettingsReadSnapshot): string {
  const providerId: AiProviderId = snapshot.defaultProvider;
  const providerName: string = getProviderStatus(snapshot, providerId)?.displayName ?? providerId;
  const modelId: string = snapshot.providerConfigs[providerId].model;
  const modelName: string =
    snapshot.modelCatalog[providerId].find((entry) => entry.id === modelId)?.displayName ?? modelId;

  return `${providerName} · ${modelName}`;
}
