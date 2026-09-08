import {
  isCliProvider,
  aiProviderIds,
  aiTaskNames,
  type AiProviderId,
  type AiTaskName,
  type CliProviderId,
} from '#ai/contracts/aiTypes';
import type { ScenePrefixDigitsInspectLike } from '@storyboard/story-format';
import { storyboardModelCatalog } from '#ai/contracts/models';
import { findStoryboardSetting, isValidStoryboardSettingValue } from '#ai/contracts/settingCatalog';

// The same numbers VSCode's ConfigurationTarget uses, which the file-backed configuration honours
// too: a write lands in the workspace file only when that layer already holds the key, so the value
// the author sees change is the one that was actually in effect.
const userConfigurationTarget = 1;
const workspaceConfigurationTarget = 2;

export type ConfigValueOrigin = 'default' | 'user' | 'workspace';

export interface ProviderModelConfig {
  readonly model?: string;
  readonly baseUrl?: string;
  readonly command?: string;
  readonly timeoutMs?: number;
  readonly reasoningEffort?: string;
}

const defaultCliGenerateTimeoutMs = 600_000;

const defaultReviseMaxIterations = 2;
const minReviseMaxIterations = 1;
const maxReviseMaxIterations = 5;

export interface TaskAiStoredEntry {
  readonly provider: AiProviderId;
  readonly model?: string;
}

export interface TaskAiConfigOverride {
  readonly providerId: AiProviderId;
  readonly model: string | null;
}

export interface TaskAiConfigResolved {
  readonly providerId: AiProviderId;
  readonly model: string;
}

export interface StoryboardConfigurationLike {
  readonly get: <T>(section: string, defaultValue: T) => T;
  readonly inspect?: <T>(section: string) =>
    | {
        readonly globalValue?: T;
        readonly workspaceValue?: T;
        readonly workspaceFolderValue?: T;
        readonly defaultValue?: T;
      }
    | undefined;
  readonly update?: <T>(
    section: string,
    value: T,
    configurationTarget?: number,
  ) => PromiseLike<void>;
}

export interface StoryboardConfigurationChangeEventLike {
  readonly affectsConfiguration: (section: string) => boolean;
}

export interface ConfigBridgeDependencies {
  readonly getConfiguration: () => StoryboardConfigurationLike;
  readonly onDidChangeConfiguration?: (
    listener: (event: StoryboardConfigurationChangeEventLike) => void,
  ) => { readonly dispose: () => void };
  // NOTE: 어느 층에 쓸지 호스트가 못박을 때 쓴다. CLI 는 git 처럼 실행 위치로 정하므로 한 번
  // 정해진 값을 넘기고, 생략하면 그 키가 이미 있던 층을 따른다.
  readonly writeTarget?: number;
}

export class ConfigBridge {
  public constructor(private readonly dependencies: ConfigBridgeDependencies) {}

  // The effective default: `mock` when nothing is configured, so read-only surfaces (status bar,
  // settings snapshot) always have a value to show. Hosts that must not generate against an
  // unchosen provider check `isDefaultProviderConfigured` (or the registry's guard) instead.
  public getDefaultProvider(): AiProviderId {
    return this.getProviderId('defaultProvider', 'mock');
  }

  public isDefaultProviderConfigured(): boolean {
    const configured = this.dependencies
      .getConfiguration()
      .get<unknown>('defaultProvider', undefined);

    return typeof configured === 'string' && isConfiguredProvider(configured);
  }

  public getProviderConfig(providerId: AiProviderId): ProviderModelConfig {
    const configuration = this.dependencies.getConfiguration();

    if (providerId === 'ollama') {
      return {
        baseUrl: configuration.get('providers.ollama.baseUrl', 'http://localhost:11434'),
        model: configuration.get('providers.ollama.model', 'llama3.3'),
      };
    }

    if (isCliProvider(providerId)) {
      const model = configuration.get(`providers.${providerId}.model`, getDefaultModel(providerId));

      const reasoningEffort =
        providerId === 'codex'
          ? configuration.get('providers.codex.reasoningEffort', '').trim() || undefined
          : undefined;

      return {
        command: configuration.get(
          `providers.${providerId}.command`,
          getDefaultCommand(providerId),
        ),
        model:
          providerId === 'codex'
            ? resolveEffectiveModelForTask(model, storyboardModelCatalog.codex[0].id, providerId)
            : model,
        timeoutMs: configuration.get(
          `providers.${providerId}.timeoutMs`,
          defaultCliGenerateTimeoutMs,
        ),
        ...(reasoningEffort ? { reasoningEffort } : {}),
      };
    }

    return {
      model: configuration.get(`providers.${providerId}.model`, getDefaultModel(providerId)),
    };
  }

  public getTaskProvider(taskName: AiTaskName): AiProviderId {
    return this.getTaskAiConfig(taskName).providerId;
  }

  public getTaskProviderOverride(taskName: AiTaskName): AiProviderId | null {
    const entry = this.getTaskAiConfigOverride(taskName);
    return entry?.providerId ?? null;
  }

  public getTaskAiConfigOverride(taskName: AiTaskName): TaskAiConfigOverride | null {
    const stored = this.readTaskStoredEntry(this.dependencies.getConfiguration(), taskName);
    if (!stored) {
      return null;
    }

    return { providerId: stored.provider, model: stored.model ?? null };
  }

  public getTaskAiConfig(taskName: AiTaskName): TaskAiConfigResolved {
    const stored = this.readTaskStoredEntry(this.dependencies.getConfiguration(), taskName);
    const defaultProvider = this.getDefaultProvider();
    const providerId = stored?.provider ?? defaultProvider;
    const runtime = this.getProviderConfig(providerId);
    const catalog = storyboardModelCatalog[providerId];
    const fallbackModelId = catalog[0].id;

    const taskModel =
      stored?.model !== undefined && isModelInCatalogForProvider(providerId, stored.model)
        ? stored.model
        : undefined;

    const model =
      taskModel ?? resolveEffectiveModelForTask(runtime.model, fallbackModelId, providerId);

    return { providerId, model };
  }

  public async setDefaultProvider(providerId: AiProviderId): Promise<void> {
    await this.configurationUpdate('defaultProvider', providerId);
  }

  public async setProviderModel(providerId: AiProviderId, model: string): Promise<void> {
    await this.configurationUpdate(`providers.${providerId}.model`, model);
  }

  public async setProviderBaseUrl(baseUrl: string): Promise<void> {
    await this.configurationUpdate('providers.ollama.baseUrl', baseUrl);
  }

  public async setProviderCommand(providerId: CliProviderId, command: string): Promise<void> {
    await this.configurationUpdate(`providers.${providerId}.command`, command);
  }

  public async setTaskAiConfig(
    taskName: AiTaskName,
    config: { readonly providerId: AiProviderId | null; readonly model: string | null },
  ): Promise<void> {
    const configuration = this.dependencies.getConfiguration();
    this.assertConfigurationUpdate(configuration);

    if (config.providerId === null) {
      await this.clearTaskAiConfig(taskName);
      return;
    }

    if (config.model === null) {
      throw new Error('setTaskAiConfig: model is required when providerId is set.');
    }

    if (!isModelInCatalogForProvider(config.providerId, config.model)) {
      throw new Error(`setTaskAiConfig: model is not allowed for provider ${config.providerId}.`);
    }

    const merged = this.readTasksPersistMap(configuration);
    merged[taskName] = { provider: config.providerId, model: config.model };
    await configuration.update('tasks', merged, this.resolveUpdateTarget('tasks'));
  }

  public async clearTaskAiConfig(taskName: AiTaskName): Promise<void> {
    const configuration = this.dependencies.getConfiguration();
    this.assertConfigurationUpdate(configuration);

    const merged = this.readTasksPersistMap(configuration);
    delete merged[taskName];
    await configuration.update('tasks', merged, this.resolveUpdateTarget('tasks'));
  }

  public getSettingValue(key: string): boolean | number | string {
    const definition = findStoryboardSetting(key);

    if (!definition) {
      throw new Error(`알 수 없는 설정입니다: ${key}`);
    }

    const value = this.dependencies.getConfiguration().get<unknown>(key, definition.defaultValue);

    return isValidStoryboardSettingValue(definition, value)
      ? (value as boolean | number | string)
      : definition.defaultValue;
  }

  public async setSettingValue(key: string, value: boolean | number | string): Promise<void> {
    const definition = findStoryboardSetting(key);

    if (!definition || !isValidStoryboardSettingValue(definition, value)) {
      throw new Error(`설정 값이 올바르지 않습니다: ${key}`);
    }

    await this.configurationUpdate(key, value);
  }

  public getValueOrigin(section: string): ConfigValueOrigin {
    const inspected = this.dependencies.getConfiguration().inspect?.<unknown>(section);

    if (inspected?.workspaceValue !== undefined || inspected?.workspaceFolderValue !== undefined) {
      return 'workspace';
    }

    return inspected?.globalValue !== undefined ? 'user' : 'default';
  }

  public isGrammarRealtimeEnabled(): boolean {
    return this.dependencies.getConfiguration().get('grammar.realtimeEnabled', false);
  }

  public isSlopRealtimeEnabled(): boolean {
    return this.dependencies.getConfiguration().get('slop.realtimeEnabled', false);
  }

  public isStudioValidationEnabled(): boolean {
    return this.dependencies.getConfiguration().get('studio.validation', true);
  }

  public getScenePrefixDigits(): number {
    return this.dependencies.getConfiguration().get('scene.prefixDigits', 2);
  }

  public inspectScenePrefixDigits(): ScenePrefixDigitsInspectLike | undefined {
    return this.dependencies.getConfiguration().inspect?.<number>('scene.prefixDigits');
  }

  public isAiContextCondenseEnabled(): boolean {
    return this.dependencies.getConfiguration().get('ai.contextCondenseEnabled', false);
  }

  public isReviseAfterGenerateEnabled(): boolean {
    return this.dependencies.getConfiguration().get('draft.reviseAfterGenerate', true);
  }

  public getReviseMaxIterations(): number {
    const configured = this.dependencies
      .getConfiguration()
      .get('draft.reviseMaxIterations', defaultReviseMaxIterations);
    const value = Math.floor(Number.isFinite(configured) ? configured : defaultReviseMaxIterations);

    return Math.min(maxReviseMaxIterations, Math.max(minReviseMaxIterations, value));
  }

  public getReviseScoreThreshold(): number {
    const configured = this.dependencies.getConfiguration().get('draft.reviseScoreThreshold', 0);
    const value = Math.floor(Number.isFinite(configured) ? configured : 0);

    return Math.min(100, Math.max(0, value));
  }

  public getMaxCompressionPercent(): number {
    const configured = this.dependencies.getConfiguration().get('draft.maxCompressionPercent', 50);
    const value = Math.floor(Number.isFinite(configured) ? configured : 50);

    return Math.min(90, Math.max(0, value));
  }

  public isUpdateCardsAfterGenerateEnabled(): boolean {
    return this.dependencies.getConfiguration().get('draft.updateCardsAfterGenerate', false);
  }

  public isVerifyCardCandidatesEnabled(): boolean {
    return this.dependencies.getConfiguration().get('draft.verifyCardCandidates', true);
  }

  public isSceneGroundingAutoApproveEnabled(): boolean {
    return this.dependencies.getConfiguration().get('grounding.autoApprove', false);
  }

  public isAutoBeatsEnabled(): boolean {
    return this.dependencies.getConfiguration().get('draft.autoBeats', true);
  }

  public getCharsPerBeat(): number {
    const configured = this.dependencies.getConfiguration().get('draft.charsPerBeat', 1500);
    const value = Math.floor(Number.isFinite(configured) ? configured : 1500);

    return Math.min(10_000, Math.max(300, value));
  }

  public getMinBeats(): number {
    const configured = this.dependencies.getConfiguration().get('draft.minBeats', 5);
    const value = Math.floor(Number.isFinite(configured) ? configured : 5);

    return Math.min(50, Math.max(1, value));
  }

  public getSectionOutputLimit(): number {
    const configured = this.dependencies.getConfiguration().get('draft.sectionOutputLimit', 7000);
    const value = Math.floor(Number.isFinite(configured) ? configured : 7000);

    return Math.min(20_000, Math.max(1_000, value));
  }

  public isKeepDraftHistoryEnabled(): boolean {
    return this.dependencies.getConfiguration().get('draft.keepHistory', false);
  }

  public getDraftSceneBreakSeparator(): string | undefined {
    const configuration = this.dependencies.getConfiguration();

    if (!configuration.get('draft.sceneBreakEnabled', false)) {
      return undefined;
    }

    return configuration.get('draft.sceneBreakSeparator', '---');
  }

  public onDidChange(listener: () => void): { readonly dispose: () => void } {
    if (!this.dependencies.onDidChangeConfiguration) {
      return { dispose: (): void => undefined };
    }

    return this.dependencies.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('storyboard')) {
        listener();
      }
    });
  }

  private getProviderId(section: string, fallback: AiProviderId): AiProviderId {
    const configuredProvider = this.dependencies
      .getConfiguration()
      .get(section, fallback as string);

    return isConfiguredProvider(configuredProvider) ? configuredProvider : fallback;
  }

  private readTaskStoredEntry(
    configuration: StoryboardConfigurationLike,
    taskName: AiTaskName,
  ): TaskAiStoredEntry | undefined {
    const fromTasksObject = configuration.get('tasks', {}) as Record<
      string,
      { provider?: string; model?: string } | undefined
    >;

    const nested = fromTasksObject[taskName];
    const fromDotProvider = configuration.get(
      `tasks.${taskName}.provider`,
      undefined as string | undefined,
    );
    const fromDotModel = configuration.get(
      `tasks.${taskName}.model`,
      undefined as string | undefined,
    );
    const rawProvider = nested?.provider ?? fromDotProvider;
    const rawModel = nested?.model ?? fromDotModel;

    if (!rawProvider || !isConfiguredProvider(rawProvider)) {
      return undefined;
    }

    const trimmedModel = typeof rawModel === 'string' ? rawModel.trim() : '';

    if (trimmedModel.length > 0 && isModelInCatalogForProvider(rawProvider, trimmedModel)) {
      return { provider: rawProvider, model: trimmedModel };
    }

    return { provider: rawProvider };
  }

  private readTasksPersistMap(
    configuration: StoryboardConfigurationLike,
  ): Record<string, { readonly provider: AiProviderId; readonly model?: string }> {
    const merged: Record<string, { readonly provider: AiProviderId; readonly model?: string }> = {};

    for (const taskName of aiTaskNames) {
      const stored = this.readTaskStoredEntry(configuration, taskName);
      if (!stored) {
        continue;
      }

      merged[taskName] =
        stored.model !== undefined
          ? { provider: stored.provider, model: stored.model }
          : { provider: stored.provider };
    }

    return merged;
  }

  private assertConfigurationUpdate(
    configuration: StoryboardConfigurationLike,
  ): asserts configuration is StoryboardConfigurationLike & {
    readonly update: NonNullable<StoryboardConfigurationLike['update']>;
  } {
    if (!configuration.update) {
      throw new Error(
        'StoryboardConfigurationLike.update is required to change Storyboard settings.',
      );
    }
  }

  private async configurationUpdate<T>(section: string, value: T): Promise<void> {
    const configuration = this.dependencies.getConfiguration();
    this.assertConfigurationUpdate(configuration);
    await configuration.update(section, value, this.resolveUpdateTarget(section));
  }

  private resolveUpdateTarget(section: string): number {
    return (
      this.dependencies.writeTarget ??
      (this.getValueOrigin(section) === 'workspace'
        ? workspaceConfigurationTarget
        : userConfigurationTarget)
    );
  }
}

function isModelInCatalogForProvider(providerId: AiProviderId, modelId: string): boolean {
  return storyboardModelCatalog[providerId].some((entry) => entry.id === modelId);
}

// Model ids retired from the CLI backends. A setting saved by an old install must upgrade to the
// current default instead of reaching the CLI as a dead model; anything NOT in this list passes
// through for CLI providers (decision #32), because the CLIs ship new names faster than the
// catalog can track and validate models themselves.
const retiredCliModelIds: Partial<Record<AiProviderId, ReadonlySet<string>>> = {
  codex: new Set(['gpt-5-codex']),
};

function resolveEffectiveModelForTask(
  configuredGlobal: string | undefined,
  fallbackModelId: string,
  providerId: AiProviderId,
): string {
  const trimmed = configuredGlobal?.trim();

  if (trimmed === undefined || trimmed.length === 0) {
    return fallbackModelId;
  }

  if (isCliProvider(providerId) || providerId === 'mock') {
    return retiredCliModelIds[providerId]?.has(trimmed) === true ? fallbackModelId : trimmed;
  }

  if (isModelInCatalogForProvider(providerId, trimmed)) {
    return trimmed;
  }

  return fallbackModelId;
}

function isConfiguredProvider(value: string): value is AiProviderId {
  return aiProviderIds.includes(value as AiProviderId);
}

function getDefaultModel(providerId: AiProviderId): string | undefined {
  switch (providerId) {
    case 'openai':
      return 'gpt-5.4-mini';
    case 'claude':
      return 'claude-sonnet-4-6';
    case 'google':
      return 'gemini-2.5-flash';
    case 'grok':
      return 'grok-4.6';
    case 'claude-code':
      return 'sonnet';
    case 'codex':
      return 'gpt-5.6-sol';
    case 'gemini-cli':
      return 'flash';
    case 'mock':
    case 'ollama':
      return undefined;
  }
}

function getDefaultCommand(providerId: CliProviderId): string {
  switch (providerId) {
    case 'claude-code':
      return 'claude';
    case 'codex':
      return 'codex';
    case 'gemini-cli':
      return 'gemini';
  }
}
