import {
  isCliProvider,
  aiProviderIds,
  aiTaskNames,
  type AiProviderId,
  type AiTaskName,
  type CliProviderId,
} from '#ai/contracts/aiTypes';
import type { ScenePrefixDigitsInspectLike } from '@storyboard/story-format';
import {
  cliProviderDefaults,
  getDefaultCliCommand,
  getDefaultModelId,
  isModelInCatalogForProvider,
  isRetiredModelId,
  providerCatalog,
  storyboardModelCatalog,
} from '#ai/contracts/providerCatalog';
import { findModelProfile, type ModelProfile } from '#ai/contracts/modelProfiles';
import { findStoryboardSetting, isValidStoryboardSettingValue } from '#ai/contracts/settingCatalog';

// The same numbers VSCode's ConfigurationTarget uses, which the file-backed configuration honours
// too: a write lands in the workspace file only when that layer already holds the key, so the value
// the author sees change is the one that was actually in effect.
const userConfigurationTarget = 1;
const workspaceConfigurationTarget = 2;

export type ConfigValueOrigin = 'default' | 'user' | 'workspace';

// 파이프라인의 SceneGenerationTuning 과 구조적으로 같다. story-ai 는 story-pipeline 을 의존하지
// 않으므로(의존 방향이 반대다) 타입을 가져오지 않고 같은 모양을 선언한다.
export type SceneGenerationTuningLike = Omit<ModelProfile, 'measured' | 'sectionOutputLimit'>;

export interface ProviderModelConfig {
  readonly model?: string;
  readonly baseUrl?: string;
  readonly command?: string;
  readonly timeoutMs?: number;
  readonly reasoningEffort?: string;
}

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
        baseUrl: configuration.get('providers.ollama.baseUrl', providerCatalog.ollama.defaultBaseUrl),
        model: configuration.get('providers.ollama.model', providerCatalog.ollama.defaultModel),
      };
    }

    if (isCliProvider(providerId)) {
      const model = configuration.get(`providers.${providerId}.model`, getDefaultModelId(providerId));

      const reasoningEffort =
        providerId === 'codex'
          ? configuration.get('providers.codex.reasoningEffort', '').trim() || undefined
          : undefined;

      return {
        command: configuration.get(
          `providers.${providerId}.command`,
          getDefaultCliCommand(providerId),
        ),
        model:
          providerId === 'codex'
            ? resolveEffectiveModelForTask(model, defaultModelIdFor(providerId), providerId)
            : model,
        timeoutMs: configuration.get(
          `providers.${providerId}.timeoutMs`,
          cliProviderDefaults.generateTimeoutMs,
        ),
        ...(reasoningEffort ? { reasoningEffort } : {}),
      };
    }

    return {
      model: configuration.get(`providers.${providerId}.model`, getDefaultModelId(providerId)),
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
    const fallbackModelId = defaultModelIdFor(providerId);

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

    // NOTE: 모델 프로필이 주는 값도 «기본값»이다. 여기서 안 보면 설정 화면은 7000 이라 말하는데
    // 생성은 15000 으로 도는, 사람이 원인을 못 찾는 어긋남이 생긴다.
    const fallback = this.getModelProfileDefault(key) ?? definition.defaultValue;
    const value = this.dependencies.getConfiguration().get<unknown>(key, fallback);

    return isValidStoryboardSettingValue(definition, value)
      ? (value as boolean | number | string)
      : fallback;
  }

  // 설정 키와 모델 프로필 항목이 같은 값을 가리키는 경우. 지금은 구간 상한 하나뿐이다.
  public getModelProfileDefault(key: string): number | undefined {
    return key === 'draft.sectionOutputLimit' ? this.getModelProfile()?.sectionOutputLimit : undefined;
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

  // 실측으로 정한 모델별 손잡이. 재보지 않은 모델이면 undefined 이고, 호출자는 자기 기본값을 쓴다.
  public getModelProfile(): ModelProfile | undefined {
    const providerId = this.getDefaultProvider();

    return findModelProfile(providerId, this.getProviderConfig(providerId).model);
  }

  // 사용자 설정 → 모델 프로필 → 코드 기본값 순. 사용자가 적은 값이 언제나 이긴다.
  public getSceneGenerationTuning(): SceneGenerationTuningLike {
    const profile = this.getModelProfile();

    if (profile === undefined) {
      return {};
    }

    const { measured: _measured, sectionOutputLimit: _limit, ...tuning } = profile;

    return tuning;
  }

  public getSectionOutputLimit(): number {
    const profileLimit = this.getModelProfileDefault('draft.sectionOutputLimit') ?? 7000;
    const configured = this.dependencies
      .getConfiguration()
      .get('draft.sectionOutputLimit', profileLimit);
    const value = Math.floor(Number.isFinite(configured) ? configured : profileLimit);

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

// mock 은 카탈로그에 기본 모델을 두지 않으므로 목록의 첫 모델이 그 자리를 대신한다.
function defaultModelIdFor(providerId: AiProviderId): string {
  return getDefaultModelId(providerId) ?? storyboardModelCatalog[providerId][0].id;
}

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
    return isRetiredModelId(providerId, trimmed) ? fallbackModelId : trimmed;
  }

  if (isModelInCatalogForProvider(providerId, trimmed)) {
    return trimmed;
  }

  return fallbackModelId;
}

function isConfiguredProvider(value: string): value is AiProviderId {
  return aiProviderIds.includes(value as AiProviderId);
}
