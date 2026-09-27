import {
  aiProviderIds,
  requiresApiKey as providerRequiresApiKey,
  type AiProviderId,
} from '@storyboard/story-engine/contracts';

export const AI_PROVIDER_IDS = aiProviderIds;
export { listSelectableProviderIds } from '@storyboard/story-engine/contracts';
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

interface ProviderRuntimeConfig {
  readonly model: string;
  readonly baseUrl?: string;
}

interface TaskAiAssignment {
  readonly providerId: AiProviderId | null;
  readonly model: string | null;
}

export interface TaskCatalogItem {
  readonly name: AiTaskName;
  readonly label: string;
}

export type ConfigValueOrigin = 'default' | 'user' | 'workspace';

export type SettingValue = boolean | number | string;

export interface SettingDefinition {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly kind: 'boolean' | 'integer' | 'string';
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

  const candidate = value as { origin?: unknown; file?: unknown };
  const origin =
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

  const candidate = value as Partial<SettingsReadSnapshot>;
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
    const cfg = (candidate.providerConfigs as Record<string, unknown>)[id];
    if (!cfg || typeof cfg !== 'object' || typeof (cfg as { model?: unknown }).model !== 'string') {
      return undefined;
    }
    const models = (candidate.modelCatalog as Record<string, unknown>)[id];
    if (!Array.isArray(models) || models.length === 0) {
      return undefined;
    }
  }

  for (const taskEntry of candidate.taskCatalog) {
    if (!taskEntry || typeof taskEntry !== 'object') {
      return undefined;
    }

    const task = taskEntry as Record<string, unknown>;
    if (typeof task.name !== 'string' || task.name.trim().length === 0) {
      return undefined;
    }
    if (typeof task.label !== 'string' || task.label.trim().length === 0) {
      return undefined;
    }

    const taskName = task.name;
    const assignment = (candidate.taskAssignments as Record<string, unknown>)[taskName];
    if (!assignment || typeof assignment !== 'object') {
      return undefined;
    }

    const row = assignment as Record<string, unknown>;
    if (!('providerId' in row) || !('model' in row)) {
      return undefined;
    }

    const providerId = row.providerId;
    const model = row.model;
    const usesDefaultProvider = providerId === null || providerId === undefined;

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
  const assignment = snapshot.taskAssignments[taskName];
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
  const catalog = snapshot.modelCatalog[providerId];
  if (preferredModelId !== null && catalog.some((entry) => entry.id === preferredModelId)) {
    return preferredModelId;
  }

  const globalModel = snapshot.providerConfigs[providerId].model;
  if (catalog.some((entry) => entry.id === globalModel)) {
    return globalModel;
  }

  return catalog[0]?.id ?? globalModel;
}

export function formatResolvedTaskAi(snapshot: SettingsReadSnapshot, taskName: AiTaskName): string {
  const assign = snapshot.taskAssignments[taskName];
  let providerId: AiProviderId;
  let modelId: string;

  if (!assign || assign.providerId === null) {
    providerId = snapshot.defaultProvider;
    modelId = snapshot.providerConfigs[providerId].model;
  } else {
    providerId = assign.providerId;
    modelId = assign.model ?? snapshot.providerConfigs[providerId].model;
  }

  const providerName = getProviderStatus(snapshot, providerId)?.displayName ?? providerId;
  const modelLabel =
    snapshot.modelCatalog[providerId].find((entry) => entry.id === modelId)?.displayName ?? modelId;

  return `${providerName} / ${modelLabel}`;
}

export function formatDefaultProviderSummary(snapshot: SettingsReadSnapshot): string {
  const providerId = snapshot.defaultProvider;
  const providerName = getProviderStatus(snapshot, providerId)?.displayName ?? providerId;
  const modelId = snapshot.providerConfigs[providerId].model;
  const modelName =
    snapshot.modelCatalog[providerId].find((entry) => entry.id === modelId)?.displayName ?? modelId;

  return `${providerName} · ${modelName}`;
}
