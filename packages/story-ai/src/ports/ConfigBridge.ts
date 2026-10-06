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
import type { ScenePrefixDigitsInspectLike } from '@storyboard/story-model';

// The same numbers VSCode's ConfigurationTarget uses, which the file-backed configuration honours
// too: a write lands in the workspace file only when that layer already holds the key, so the value
// the author sees change is the one that was actually in effect.
const userConfigurationTarget = 1;
const workspaceConfigurationTarget = 2;

export type ConfigValueOrigin = 'default' | 'user' | 'workspace';

export interface ProviderModelConfig {
  readonly model?: string;
  readonly baseUrl?: string;
  // 로컬 런타임이 실제로 쓸 문맥 창. 기계마다 VRAM 이 달라 코드가 정할 수 없다.
  readonly contextTokens?: number;
  // 생각(thinking)을 켤지. 안 주면 ollama 가 모델 기본값을 쓴다. 생각하는 모델은 상한 없이 생각하면
  // 한 호출이 수십 분이 될 수 있어, 측정에서는 명시적으로 끄거나 켜서 잰다.
  readonly think?: boolean;
}

// 실행 파일로 부르는 프로바이더가 홈 설정에서 받는 두 값. 둘 다 없으면 PATH 의 실행 파일과
// 프로바이더의 기본 시간 제한을 쓴다.
export interface CliProviderConfig {
  readonly command?: string;
  readonly timeoutMs?: number;
}

export const promptVariantIds = ['generic', 'xs', 'rich'] as const;
export type PromptVariantOverride = (typeof promptVariantIds)[number];

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
    return this.getProviderId('ai.provider.default', 'mock');
  }

  public isDefaultProviderConfigured(): boolean {
    const configured = this.dependencies
      .getConfiguration()
      .get<unknown>('ai.provider.default', undefined);

    return typeof configured === 'string' && this.resolveStoredProviderId(configured) !== undefined;
  }

  // SECURITY: 숨은 프로바이더의 키는 홈 설정 파일의 값만 본다. 작품에 딸려 온 설정 파일이 이 기계의
  // 구독을 켜거나 실행 파일을 고를 수 있어서는 안 된다.
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

  // Once off, the name is unknown, and a config file that still routes to it would be rejected as a
  // whole. So the routes go first, while the name still reads, then the switch. Returns the keys it
  // cleared so the host can tell the person to choose again.
  public async disableHiddenProvider(providerId: AiProviderId): Promise<readonly string[]> {
    const configuration = this.dependencies.getConfiguration();
    this.assertConfigurationUpdate(configuration);
    const routeKeys = [
      'ai.provider.default',
      ...aiTaskNames.map((taskName) => `tasks.${taskName}.provider`),
    ];
    const clearedKeys: string[] = [];

    for (const key of routeKeys) {
      const inspected = configuration.inspect?.<unknown>(key);
      const layers = [
        [inspected?.globalValue, userConfigurationTarget],
        [inspected?.workspaceValue, workspaceConfigurationTarget],
      ] as const;

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

  // 켜지 않은 숨은 프로바이더는 없는 이름이다. 이름을 보여 주거나 받는 곳은 전부 이 목록을 쓴다.
  public getAvailableProviderIds(): AiProviderId[] {
    return listAvailableProviderIds(this.getEnabledHiddenProviderIds());
  }

  public isProviderAvailable(providerId: AiProviderId): boolean {
    return !isHiddenProvider(providerId) || this.isHiddenProviderEnabled(providerId);
  }

  public getCliProviderConfig(providerId: AiProviderId): CliProviderConfig {
    const command = this.readHomeValue(`providers.${providerId}.command`);
    const timeoutMs = this.readHomeValue(`providers.${providerId}.timeoutMs`);

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
    const configuration = this.dependencies.getConfiguration();
    this.assertConfigurationUpdate(configuration);
    await configuration.update(section, value, userConfigurationTarget);
  }

  public getProviderConfig(providerId: AiProviderId): ProviderModelConfig {
    const configuration = this.dependencies.getConfiguration();

    if (providerId === 'ollama') {
      const contextTokens = configuration.get<number | undefined>(
        'providers.ollama.contextTokens',
        undefined,
      );
      const think = configuration.get<boolean | undefined>('providers.ollama.think', undefined);

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

  // NOTE: 프롬프트 변형은 모델 이름으로 자동으로 정해진다 — 로컬의 qwen·gemma 계열은 전부 압축형(xs)
  // 이다. 무엇이 상한을 정하는지 재려면 같은 모델에 다른 변형을 강제로 물려 봐야 하므로, 설정으로
  // 덮어쓸 수 있게 한다. 모르는 값은 «지정 안 함» 으로 본다.
  public getPromptVariantOverride(): PromptVariantOverride | undefined {
    const value = this.dependencies.getConfiguration().get<unknown>('ai.prompt.variant', undefined);

    return typeof value === 'string' && (promptVariantIds as readonly string[]).includes(value)
      ? (value as PromptVariantOverride)
      : undefined;
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
    return key === sectionOutputLimitParameterId ? this.getModelProfile()?.knobs[key] : undefined;
  }

  public async setSettingValue(key: string, value: boolean | number | string): Promise<void> {
    const definition = findStoryboardSetting(key);

    if (!definition || !isValidStoryboardSettingValue(definition, value)) {
      throw new Error(`설정 값이 올바르지 않습니다: ${key}`);
    }

    await this.configurationUpdate(key, value);
  }

  private readBooleanSetting(key: string): boolean {
    return this.dependencies.getConfiguration().get(key, booleanSettingDefault(key));
  }

  private readIntegerSetting(key: string, fallback?: number): number {
    const defaultValue = fallback ?? integerSettingDefault(key);
    const configured = this.dependencies.getConfiguration().get(key, defaultValue);
    const value = Math.floor(Number.isFinite(configured) ? configured : defaultValue);

    return clampIntegerSetting(key, value);
  }

  private readDecimalSetting(key: string): number {
    const defaultValue = decimalSettingDefault(key);
    const configured = this.dependencies.getConfiguration().get(key, defaultValue);

    return clampDecimalSetting(key, Number.isFinite(configured) ? configured : defaultValue);
  }

  public getValueOrigin(section: string): ConfigValueOrigin {
    const inspected = this.dependencies.getConfiguration().inspect?.<unknown>(section);

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

  // 실측으로 정한 모델별 손잡이. 재보지 않은 모델이면 undefined 이고, 호출자는 자기 기본값을 쓴다.
  public getModelProfile(): ModelProfile | undefined {
    const providerId = this.getDefaultProvider();

    return findModelProfile(providerId, this.getProviderConfig(providerId).model);
  }

  // 사용자 설정 → 모델 프로필 → 코드 기본값 순. 사용자가 적은 값이 언제나 이긴다.
  public getSceneGenerationTuning(): GenerationKnobs {
    const profile = this.getModelProfile();

    if (profile === undefined) {
      return {};
    }

    const { [sectionOutputLimitParameterId]: _limit, ...knobs } = profile.knobs;

    return knobs;
  }

  // 사용자 설정 → 모델 실측 프로필 → 카탈로그 기본값 순.
  public getSectionOutputLimit(): number {
    const profileLimit =
      this.getModelProfileDefault('generation.section.outputLimit') ??
      integerSettingDefault('generation.section.outputLimit');

    return this.readIntegerSetting('generation.section.outputLimit', profileLimit);
  }

  public isKeepDraftHistoryEnabled(): boolean {
    return this.readBooleanSetting('editor.draft.keepHistory');
  }

  public getDraftSceneBreakSeparator(): string | undefined {
    const configuration = this.dependencies.getConfiguration();

    if (!this.readBooleanSetting('generation.sceneBreak.enabled')) {
      return undefined;
    }

    return configuration.get(
      'generation.sceneBreak.separator',
      stringSettingDefault('generation.sceneBreak.separator'),
    );
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

    return this.resolveStoredProviderId(configuredProvider) ?? fallback;
  }

  // 설정 파일이 적어 둔 프로바이더 이름. 카탈로그에 없거나 켜지 않은 숨은 프로바이더면 undefined
  // 이고, 호출자는 «고르지 않음» 으로 다룬다 — 없어진 이름을 말없이 다른 프로바이더로 바꾸지 않는다.
  // 모델도 요금도 다르기 때문에 사람이 다시 고르는 편이 낫다.
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

    const provider = rawProvider ? this.resolveStoredProviderId(rawProvider) : undefined;

    if (provider === undefined) {
      return undefined;
    }

    const trimmedModel = typeof rawModel === 'string' ? rawModel.trim() : '';

    if (trimmedModel.length > 0 && isModelInCatalogForProvider(provider, trimmedModel)) {
      return { provider, model: trimmedModel };
    }

    return { provider };
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

  if (providerId === 'mock') {
    return trimmed;
  }

  // NOTE: 로컬 런타임의 모델은 사용자가 내려받은 태그다. 카탈로그는 추천 목록이지 허용 목록이 아니다.
  // 카탈로그 갱신으로 태그가 빠졌다고 설정한 모델을 기본 모델로 바꿔치기하면, 기계에 없는 모델을
  // 부르다 404 로 죽거나 — 더 나쁘게는 — 다른 모델로 조용히 잰다. 0.9.4 갱신 때 실측이 그렇게 죽었다.
  if (providerId === 'ollama') {
    return trimmed;
  }

  if (isModelInCatalogForProvider(providerId, trimmed)) {
    return trimmed;
  }

  return fallbackModelId;
}
