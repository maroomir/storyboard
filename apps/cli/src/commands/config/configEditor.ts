import {
  describeModelOutsideCatalog,
  findProviderModelProblem,
  isTaskName,
} from '@/commands/config/configKeys';
import { availableProviderIds, isAvailableProviderId } from '@/adapters/availableProviders';
import type { ProviderKey } from '@/commands/catalog';
import type { CommandOutcome } from '@/commands/outcome';
import { failure, success } from '@/commands/outcomes';
import type { CliContainer } from '@/container';
import type { TaskAiConfigOverride } from '@storyboard/story-ai';
import {
  aiTaskNames,
  type AiTaskName,
  isModelInCatalogForProvider,
  type AiProviderId,
  type ConfigValueOrigin,
} from '@storyboard/story-model';

export class ConfigEditor {
  public constructor(private readonly container: CliContainer) {}

  public describeOrigin(key: string): string {
    const { configBridge } = this.container;
    switch (configBridge.getValueOrigin(key)) {
      case 'workspace':
        return '이 작품';
      case 'user':
        return '공통';
      default:
        return configBridge.getModelProfileDefault(key) === undefined ? '기본값' : '모델 실측';
    }
  }

  public describeSaved(key: string, value: unknown, notes: readonly string[] = []): CommandOutcome {
    const file: string = this.container.configWriteFile;
    const origin: ConfigValueOrigin = this.container.configBridge.getValueOrigin(key);
    const isShadowed: boolean =
      file === this.container.homePaths.configFile && origin === 'workspace';

    return success(
      [
        `${key} = ${String(value)} 저장했습니다: ${file}`,
        ...notes,
        ...(isShadowed
          ? [`다만 이 작품의 ${this.container.workspaceConfigFile} 값이 우선합니다.`]
          : []),
      ].join('\n'),
      { key, value, origin, file },
    );
  }

  public async setProviderField(
    providerId: AiProviderId,
    field: ProviderKey,
    raw: string,
  ): Promise<CommandOutcome> {
    const { configBridge } = this.container;

    if (field === 'model') {
      const modelProblem: string | undefined = findProviderModelProblem(providerId, raw);
      if (modelProblem !== undefined) {
        return failure(modelProblem);
      }
      await configBridge.setProviderModel(providerId, raw);
    } else if (field === 'baseUrl') {
      if (providerId !== 'ollama') {
        return failure('baseUrl 은 ollama 에만 있습니다.');
      }
      await configBridge.setProviderBaseUrl(raw);
    } else {
      if (providerId !== 'ollama') {
        return failure('contextTokens 는 ollama 에만 있습니다.');
      }

      const tokens: number = Number(raw);
      if (!Number.isInteger(tokens) || tokens <= 0) {
        return failure(`contextTokens 는 양의 정수여야 합니다: ${raw}`);
      }

      await configBridge.setProviderContextTokens(tokens);
    }

    return this.describeSaved(`providers.${providerId}.${field}`, raw);
  }

  public async setTaskRoute(
    taskName: string,
    field: 'provider' | 'model',
    raw: string,
    modelFlag: string | undefined,
  ): Promise<CommandOutcome> {
    if (!isTaskName(taskName)) {
      return failure(`알 수 없는 작업: ${taskName}\n쓸 수 있는 값: ${aiTaskNames.join(', ')}`);
    }

    const current: TaskAiConfigOverride | null =
      this.container.configBridge.getTaskAiConfigOverride(taskName);

    return field === 'model'
      ? this.setTaskModel(taskName, raw, modelFlag, current)
      : this.setTaskProvider(taskName, raw, modelFlag, current);
  }

  private async setTaskModel(
    taskName: AiTaskName,
    raw: string,
    modelFlag: string | undefined,
    current: TaskAiConfigOverride | null,
  ): Promise<CommandOutcome> {
    const { configBridge } = this.container;

    if (modelFlag !== undefined) {
      return failure(
        `--model 은 tasks.${taskName}.provider 와 함께 씁니다. 모델만 바꾸려면 값으로 주세요.`,
      );
    }

    const isFilledFromDefault: boolean = current === null;

    if (isFilledFromDefault && !configBridge.isDefaultProviderConfigured()) {
      return failure(
        `기본 프로바이더가 없어 ${raw} 가 어느 프로바이더의 모델인지 알 수 없습니다.\n` +
          `  storyboard config set tasks.${taskName}.provider <프로바이더> --model ${raw}`,
      );
    }

    const providerId: AiProviderId = current?.providerId ?? configBridge.getDefaultProvider();

    if (!isModelInCatalogForProvider(providerId, raw)) {
      return failure(describeModelOutsideCatalog(providerId, raw));
    }

    await configBridge.setTaskAiConfig(taskName, { providerId, model: raw });
    return this.describeSaved(
      `tasks.${taskName}.model`,
      raw,
      isFilledFromDefault
        ? [`프로바이더는 기본값 ${providerId} 로 함께 저장했습니다 (tasks.${taskName}.provider).`]
        : [],
    );
  }

  private async setTaskProvider(
    taskName: AiTaskName,
    raw: string,
    modelFlag: string | undefined,
    current: TaskAiConfigOverride | null,
  ): Promise<CommandOutcome> {
    if (!isAvailableProviderId(raw)) {
      return failure(
        `알 수 없는 프로바이더: ${raw}\n쓸 수 있는 값: ${availableProviderIds().join(', ')}`,
      );
    }

    if (modelFlag !== undefined && !isModelInCatalogForProvider(raw, modelFlag)) {
      return failure(describeModelOutsideCatalog(raw, modelFlag));
    }

    const model: string | null = modelFlag ?? this.keepTaskModelFor(taskName, raw, current);

    await this.container.configBridge.setTaskAiConfig(taskName, { providerId: raw, model });
    return this.describeSaved(
      `tasks.${taskName}.provider`,
      raw,
      modelFlag === undefined ? [] : [`tasks.${taskName}.model = ${modelFlag}`],
    );
  }

  private keepTaskModelFor(
    taskName: AiTaskName,
    providerId: AiProviderId,
    current: TaskAiConfigOverride | null,
  ): string | null {
    const keptModel: string | null = current?.model ?? null;
    const isKeptModelUsable: boolean =
      keptModel !== null && isModelInCatalogForProvider(providerId, keptModel);

    if (keptModel !== null && !isKeptModelUsable) {
      this.container.logger.warn(
        `tasks.${taskName}.model 을 비웠습니다: ${keptModel} 는 ${providerId} 의 모델이 아닙니다. ` +
          `${providerId} 에 정한 모델로 실행합니다.`,
      );
    }

    return isKeptModelUsable ? keptModel : null;
  }
}
