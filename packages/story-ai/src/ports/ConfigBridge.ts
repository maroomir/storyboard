import {
  aiProviderIds,
  aiTaskNames,
  type AiProviderId,
  type AiTaskName,
  getDefaultModelId,
  hiddenProviderEnabledKey,
  hiddenProviderIds,
  hiddenProviderRiskAcknowledgedKey,
  isHiddenProvider,
  isModelInCatalogForProvider,
  listAvailableProviderIds,
  providerCatalog,
  storyboardModelCatalog,
  findModelProfile,
  type ModelProfile,
  sectionOutputLimitParameterId,
  type GenerationKnobs,
  booleanSettingDefault,
  clampDecimalSetting,
  clampIntegerSetting,
  decimalSettingDefault,
  findStoryboardSetting,
  integerSettingDefault,
  isValidStoryboardSettingValue,
  stringSettingDefault,
} from '@storyboard/story-model';
import type {
  DisposableHandle,
  ScenePrefixDigitsInspectLike,
  StoryboardSettingDefinition,
} from '@storyboard/story-model';

const userConfigurationTarget: number = 1;
const workspaceConfigurationTarget: number = 2;

export type ConfigValueOrigin = 'default' | 'user' | 'workspace';

export interface ProviderModelConfig {
  readonly model?: string;
  readonly baseUrl?: string;
  readonly contextTokens?: number;
  readonly think?: boolean;
}

export interface CliProviderConfig {
  readonly command?: string;
  readonly timeoutMs?: number;
}

export type PromptVariantOverride = 'generic' | 'xs' | 'rich';
export const promptVariantIds: readonly PromptVariantOverride[] = ['generic', 'xs', 'rich'];

interface RawTaskRoute {
  readonly provider?: string;
  readonly model?: string;
}

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

export interface ConfigurationInspection<T> {
  readonly globalValue?: T;
  readonly workspaceValue?: T;
  readonly workspaceFolderValue?: T;
  readonly defaultValue?: T;
}

export interface StoryboardConfigurationLike {
  readonly get: <T>(section: string, defaultValue: T) => T;
  readonly inspect?: <T>(section: string) => ConfigurationInspection<T> | undefined;
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
  ) => DisposableHandle;
  readonly writeTarget?: number;
}

export class ConfigBridge {
  public constructor(private readonly dependencies: ConfigBridgeDependencies) {}

  public getDefaultProvider(): AiProviderId {
    return this.getProviderId('ai.provider.default', 'mock');
  }

  public isDefaultProviderConfigured(): boolean {
    const configured: unknown = this.dependencies
      .getConfiguration()
      .get<unknown>('ai.provider.default', undefined);

    return typeof configured === 'string' && this.resolveStoredProviderId(configured) !== undefined;
  }

  public isHiddenProviderEnabled(providerId: AiProviderId): boolean {
    return this.readHomeValue(hiddenProviderEnabledKey(providerId)) === true;
  }

  public isHiddenProviderRiskAcknowledged(providerId: AiProviderId): boolean {
    return this.readHomeValue(hiddenProviderRiskAcknowledgedKey(providerId)) === true;
  }

  public async acknowledgeHiddenProviderRisk(providerId: AiProviderId): Promise<void> {
    await this.updateHomeValue(hiddenProviderRiskAcknowledgedKey(providerId), true);
  }

  public async enableHiddenProvider(providerId: AiProviderId): Promise<void> {
    await this.updateHomeValue(hiddenProviderEnabledKey(providerId), true);
  }

  public async disableHiddenProvider(providerId: AiProviderId): Promise<readonly string[]> {
    const configuration: StoryboardConfigurationLike = this.dependencies.getConfiguration();
    this.assertConfigurationUpdate(configuration);
    const routeKeys: string[] = [
      'ai.provider.default',
      ...aiTaskNames.map((taskName) => `tasks.${taskName}.provider`),
    ];
    const clearedKeys: string[] = [];

    for (const key of routeKeys) {
      const inspected: ConfigurationInspection<unknown> | undefined =
        configuration.inspect?.<unknown>(key);
      const layers: readonly (readonly [unknown, number])[] = [
        [inspected?.globalValue, userConfigurationTarget],
        [inspected?.workspaceValue, workspaceConfigurationTarget],
      ];

      for (const [value, target] of layers) {
        if (value !== providerId) {
          continue;
        }

        await configuration.update(key, undefined, target);
        if (key.startsWith('tasks.')) {
          await configuration.update(key.replace(/\.provider$/, '.model'), undefined, target);
        }
        clearedKeys.push(key);
      }
    }

    await this.updateHomeValue(hiddenProviderEnabledKey(providerId), false);
    return clearedKeys;
  }

  public getEnabledHiddenProviderIds(): AiProviderId[] {
    return hiddenProviderIds.filter((providerId) => this.isHiddenProviderEnabled(providerId));
  }

  public getAvailableProviderIds(): AiProviderId[] {
    return listAvailableProviderIds(this.getEnabledHiddenProviderIds());
  }

  public isProviderAvailable(providerId: AiProviderId): boolean {
    return !isHiddenProvider(providerId) || this.isHiddenProviderEnabled(providerId);
  }

  public getCliProviderConfig(providerId: AiProviderId): CliProviderConfig {
    const command: unknown = this.readHomeValue(`providers.${providerId}.command`);
    const timeoutMs: unknown = this.readHomeValue(`providers.${providerId}.timeoutMs`);

    return {
      ...(typeof command === 'string' && command.trim().length > 0
        ? { command: command.trim() }
        : {}),
      ...(typeof timeoutMs === 'number' && timeoutMs > 0 ? { timeoutMs } : {}),
    };
  }

  public async setCliProviderConfig(
    providerId: AiProviderId,
    config: CliProviderConfig,
  ): Promise<void> {
    if (config.command !== undefined) {
      await this.updateHomeValue(`providers.${providerId}.command`, config.command);
    }

    if (config.timeoutMs !== undefined) {
      await this.updateHomeValue(`providers.${providerId}.timeoutMs`, config.timeoutMs);
    }
  }

  private readHomeValue(section: string): unknown {
    return this.dependencies.getConfiguration().inspect?.<unknown>(section)?.globalValue;
  }

  private async updateHomeValue<T>(section: string, value: T): Promise<void> {
    const configuration: StoryboardConfigurationLike = this.dependencies.getConfiguration();
    this.assertConfigurationUpdate(configuration);
    await configuration.update(section, value, userConfigurationTarget);
  }

  public getProviderConfig(providerId: AiProviderId): ProviderModelConfig {
    const configuration: StoryboardConfigurationLike = this.dependencies.getConfiguration();

    if (providerId === 'ollama') {
      const contextTokens: number | undefined = configuration.get<number | undefined>(
        'providers.ollama.contextTokens',
        undefined,
      );
      const think: boolean | undefined = configuration.get<boolean | undefined>(
        'providers.ollama.think',
        undefined,
      );

      return {
        baseUrl: configuration.get(
          'providers.ollama.baseUrl',
          providerCatalog.ollama.defaultBaseUrl,
        ),
        model: configuration.get('providers.ollama.model', providerCatalog.ollama.defaultModel),
        ...(typeof contextTokens === 'number' && contextTokens > 0 ? { contextTokens } : {}),
        ...(typeof think === 'boolean' ? { think } : {}),
      };
    }

    return {
      model: configuration.get(`providers.${providerId}.model`, getDefaultModelId(providerId)),
    };
  }

  public getPromptVariantOverride(): PromptVariantOverride | undefined {
    const value: unknown = this.dependencies
      .getConfiguration()
      .get<unknown>('ai.prompt.variant', undefined);

    return typeof value === 'string' && (promptVariantIds as readonly string[]).includes(value)
      ? (value as PromptVariantOverride)
      : undefined;
  }

  public getTaskProvider(taskName: AiTaskName): AiProviderId {
    return this.getTaskAiConfig(taskName).providerId;
  }

  public getTaskProviderOverride(taskName: AiTaskName): AiProviderId | null {
    const entry: TaskAiConfigOverride | null = this.getTaskAiConfigOverride(taskName);
    return entry?.providerId ?? null;
  }

  public getTaskAiConfigOverride(taskName: AiTaskName): TaskAiConfigOverride | null {
    const stored: TaskAiStoredEntry | undefined = this.readTaskStoredEntry(
      this.dependencies.getConfiguration(),
      taskName,
    );
    if (!stored) {
      return null;
    }

    return { providerId: stored.provider, model: stored.model ?? null };
  }

  public getTaskAiConfig(taskName: AiTaskName): TaskAiConfigResolved {
    const stored: TaskAiStoredEntry | undefined = this.readTaskStoredEntry(
      this.dependencies.getConfiguration(),
      taskName,
    );
    const defaultProvider: AiProviderId = this.getDefaultProvider();
    const providerId: AiProviderId = stored?.provider ?? defaultProvider;
    const runtime: ProviderModelConfig = this.getProviderConfig(providerId);
    const fallbackModelId: string = defaultModelIdFor(providerId);

    const taskModel: string | undefined =
      stored?.model !== undefined && isModelInCatalogForProvider(providerId, stored.model)
        ? stored.model
        : undefined;

    const model: string =
      taskModel ?? resolveEffectiveModelForTask(runtime.model, fallbackModelId, providerId);

    return { providerId, model };
  }

  public async setDefaultProvider(providerId: AiProviderId): Promise<void> {
    await this.configurationUpdate('ai.provider.default', providerId);
  }

  public async setProviderModel(providerId: AiProviderId, model: string): Promise<void> {
    await this.configurationUpdate(`providers.${providerId}.model`, model);
  }

  public async setProviderContextTokens(contextTokens: number): Promise<void> {
    await this.configurationUpdate('providers.ollama.contextTokens', contextTokens);
  }

  public async setProviderBaseUrl(baseUrl: string): Promise<void> {
    await this.configurationUpdate('providers.ollama.baseUrl', baseUrl);
  }

  public async setTaskAiConfig(
    taskName: AiTaskName,
    config: { readonly providerId: AiProviderId | null; readonly model: string | null },
  ): Promise<void> {
    if (config.providerId === null) {
      await this.clearTaskAiConfig(taskName);
      return;
    }

    if (config.model !== null && !isModelInCatalogForProvider(config.providerId, config.model)) {
      throw new Error(`setTaskAiConfig: model is not allowed for provider ${config.providerId}.`);
    }

    await this.updateTaskRoute(taskName, config.providerId, config.model ?? undefined);
  }

  public async clearTaskAiConfig(taskName: AiTaskName): Promise<void> {
    await this.updateTaskRoute(taskName, undefined, undefined);
  }

  private async updateTaskRoute(
    taskName: AiTaskName,
    providerId: AiProviderId | undefined,
    model: string | undefined,
  ): Promise<void> {
    const configuration: StoryboardConfigurationLike = this.dependencies.getConfiguration();
    this.assertConfigurationUpdate(configuration);
    const providerKey: string = `tasks.${taskName}.provider`;
    const target: number = this.resolveUpdateTarget(providerKey);

    await configuration.update(providerKey, providerId, target);
    await configuration.update(`tasks.${taskName}.model`, model, target);
  }

  public getConfiguredValue(section: string): unknown {
    return this.dependencies.getConfiguration().get<unknown>(section, undefined);
  }

  public async clearValue(section: string): Promise<void> {
    await this.configurationUpdate(section, undefined);
  }

  public getSettingValue(key: string): boolean | number | string {
    const definition: StoryboardSettingDefinition | undefined = findStoryboardSetting(key);

    if (!definition) {
      throw new Error(`알 수 없는 설정입니다: ${key}`);
    }

    const fallback: string | number | boolean =
      this.getModelProfileDefault(key) ?? definition.defaultValue;
    const value: unknown = this.dependencies.getConfiguration().get<unknown>(key, fallback);

    return isValidStoryboardSettingValue(definition, value)
      ? (value as boolean | number | string)
      : fallback;
  }

  public getModelProfileDefault(key: string): number | undefined {
    return key === sectionOutputLimitParameterId ? this.getModelProfile()?.knobs[key] : undefined;
  }

  public async setSettingValue(key: string, value: boolean | number | string): Promise<void> {
    const definition: StoryboardSettingDefinition | undefined = findStoryboardSetting(key);

    if (!definition || !isValidStoryboardSettingValue(definition, value)) {
      throw new Error(`설정 값이 올바르지 않습니다: ${key}`);
    }

    await this.configurationUpdate(key, value);
  }

  private readBooleanSetting(key: string): boolean {
    return this.dependencies.getConfiguration().get(key, booleanSettingDefault(key));
  }

  private readIntegerSetting(key: string, fallback?: number): number {
    const defaultValue: number = fallback ?? integerSettingDefault(key);
    const configured: number = this.dependencies.getConfiguration().get(key, defaultValue);
    const value: number = Math.floor(Number.isFinite(configured) ? configured : defaultValue);

    return clampIntegerSetting(key, value);
  }

  private readDecimalSetting(key: string): number {
    const defaultValue: number = decimalSettingDefault(key);
    const configured: number = this.dependencies.getConfiguration().get(key, defaultValue);

    return clampDecimalSetting(key, Number.isFinite(configured) ? configured : defaultValue);
  }

  public getValueOrigin(section: string): ConfigValueOrigin {
    const inspected: ConfigurationInspection<unknown> | undefined = this.dependencies
      .getConfiguration()
      .inspect?.<unknown>(section);

    if (inspected?.workspaceValue !== undefined || inspected?.workspaceFolderValue !== undefined) {
      return 'workspace';
    }

    return inspected?.globalValue !== undefined ? 'user' : 'default';
  }

  public isGrammarRealtimeEnabled(): boolean {
    return this.readBooleanSetting('editor.grammar.realtime');
  }

  public isSlopRealtimeEnabled(): boolean {
    return this.readBooleanSetting('editor.slop.realtime');
  }

  public isStudioValidationEnabled(): boolean {
    return this.readBooleanSetting('editor.studio.validation');
  }

  public getScenePrefixDigits(): number {
    return this.readIntegerSetting('editor.scene.prefixDigits');
  }

  public inspectScenePrefixDigits(): ScenePrefixDigitsInspectLike | undefined {
    return this.dependencies.getConfiguration().inspect?.<number>('editor.scene.prefixDigits');
  }

  public isAiContextCondenseEnabled(): boolean {
    return this.readBooleanSetting('generation.context.condense');
  }

  public isReviseAfterGenerateEnabled(): boolean {
    return this.readBooleanSetting('revise.loop.afterGenerate');
  }

  public getReviseMaxIterations(): number {
    return this.readIntegerSetting('revise.loop.maxIterations');
  }

  public getReviseScoreThreshold(): number {
    return this.readIntegerSetting('revise.loop.scoreThreshold');
  }

  public getMaxCompressionPercent(): number {
    return this.readIntegerSetting('revise.length.maxCompressionPercent');
  }

  public isUpdateCardsAfterGenerateEnabled(): boolean {
    return this.readBooleanSetting('cards.candidates.updateAfterGenerate');
  }

  public isVerifyCardCandidatesEnabled(): boolean {
    return this.readBooleanSetting('cards.candidates.verify');
  }

  public getRunBudgetUsd(): number {
    return this.readDecimalSetting('budget.run.limitUsd');
  }

  public isSceneGroundingAutoApproveEnabled(): boolean {
    return this.readBooleanSetting('generation.grounding.autoApprove');
  }

  public isAutoBeatsEnabled(): boolean {
    return this.readBooleanSetting('generation.beats.auto');
  }

  public getCharsPerBeat(): number {
    return this.readIntegerSetting('generation.beats.charsPerBeat');
  }

  public getMinBeats(): number {
    return this.readIntegerSetting('generation.beats.minimum');
  }

  public getModelProfile(): ModelProfile | undefined {
    const providerId: AiProviderId = this.getDefaultProvider();

    return findModelProfile(providerId, this.getProviderConfig(providerId).model);
  }

  public getSceneGenerationTuning(): GenerationKnobs {
    const profile: ModelProfile | undefined = this.getModelProfile();

    if (profile === undefined) {
      return {};
    }

    const { [sectionOutputLimitParameterId]: _limit, ...knobs } = profile.knobs;

    return knobs;
  }

  public getSectionOutputLimit(): number {
    const profileLimit: number =
      this.getModelProfileDefault('generation.section.outputLimit') ??
      integerSettingDefault('generation.section.outputLimit');

    return this.readIntegerSetting('generation.section.outputLimit', profileLimit);
  }

  public isKeepDraftHistoryEnabled(): boolean {
    return this.readBooleanSetting('editor.draft.keepHistory');
  }

  public getDraftSceneBreakSeparator(): string | undefined {
    const configuration: StoryboardConfigurationLike = this.dependencies.getConfiguration();

    if (!this.readBooleanSetting('generation.sceneBreak.enabled')) {
      return undefined;
    }

    return configuration.get(
      'generation.sceneBreak.separator',
      stringSettingDefault('generation.sceneBreak.separator'),
    );
  }

  public onDidChange(listener: () => void): DisposableHandle {
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
    const configuredProvider: string = this.dependencies
      .getConfiguration()
      .get(section, fallback as string);

    return this.resolveStoredProviderId(configuredProvider) ?? fallback;
  }

  private resolveStoredProviderId(value: string): AiProviderId | undefined {
    return aiProviderIds.includes(value as AiProviderId) &&
      this.isProviderAvailable(value as AiProviderId)
      ? (value as AiProviderId)
      : undefined;
  }

  private readTaskStoredEntry(
    configuration: StoryboardConfigurationLike,
    taskName: AiTaskName,
  ): TaskAiStoredEntry | undefined {
    const fromTasksObject: Record<string, RawTaskRoute | undefined> = configuration.get(
      'tasks',
      {},
    ) as Record<string, RawTaskRoute | undefined>;

    const nested: RawTaskRoute | undefined = fromTasksObject[taskName];
    const fromDotProvider: string | undefined = configuration.get(
      `tasks.${taskName}.provider`,
      undefined as string | undefined,
    );
    const fromDotModel: string | undefined = configuration.get(
      `tasks.${taskName}.model`,
      undefined as string | undefined,
    );
    const rawProvider: string | undefined = nested?.provider ?? fromDotProvider;
    const rawModel: string | undefined = nested?.model ?? fromDotModel;

    const provider: AiProviderId | undefined = rawProvider
      ? this.resolveStoredProviderId(rawProvider)
      : undefined;

    if (provider === undefined) {
      return undefined;
    }

    const trimmedModel: string = typeof rawModel === 'string' ? rawModel.trim() : '';

    if (trimmedModel.length > 0 && isModelInCatalogForProvider(provider, trimmedModel)) {
      return { provider, model: trimmedModel };
    }

    return { provider };
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
    const configuration: StoryboardConfigurationLike = this.dependencies.getConfiguration();
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

function defaultModelIdFor(providerId: AiProviderId): string {
  return getDefaultModelId(providerId) ?? storyboardModelCatalog[providerId][0].id;
}

function resolveEffectiveModelForTask(
  configuredGlobal: string | undefined,
  fallbackModelId: string,
  providerId: AiProviderId,
): string {
  const trimmed: string | undefined = configuredGlobal?.trim();

  if (trimmed === undefined || trimmed.length === 0) {
    return fallbackModelId;
  }

  if (providerId === 'mock') {
    return trimmed;
  }

  if (providerId === 'ollama') {
    return trimmed;
  }

  if (isModelInCatalogForProvider(providerId, trimmed)) {
    return trimmed;
  }

  return fallbackModelId;
}
