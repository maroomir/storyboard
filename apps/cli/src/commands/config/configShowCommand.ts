import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import { type CommandSpec, providerKeys } from '@/commands/catalog';
import { ConfigEditor } from '@/commands/config/configEditor';
import { availableProviderIds } from '@/adapters/availableProviders';
import type { ProviderModelConfig, TaskAiConfigOverride } from '@storyboard/story-ai';
import { aiTaskNames, storyboardSettingCatalog } from '@storyboard/story-model';
import { success } from '@/commands/outcomes';

export class ConfigShowCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'config show',
    group: '시작하기',
    usage: 'config show',
    summary: '적용 중인 설정과 출처(공통/이 작품/기본값)를 보여 줍니다',
    needsWorkspace: false,
  };

  public async execute({ container }: CommandContext): Promise<CommandOutcome> {
    const { configBridge } = container;
    const editor: ConfigEditor = new ConfigEditor(container);
    const rows: Array<{ key: string; value: unknown; origin: string }> = [
      {
        key: 'ai.provider.default',
        value: configBridge.isDefaultProviderConfigured()
          ? configBridge.getDefaultProvider()
          : null,
        origin: editor.describeOrigin('ai.provider.default'),
      },
    ];

    for (const providerId of availableProviderIds()) {
      const runtime: ProviderModelConfig = configBridge.getProviderConfig(providerId);
      for (const key of providerKeys) {
        const value: string | number | undefined = runtime[key];
        if (value !== undefined) {
          const settingKey: string = `providers.${providerId}.${key}`;
          rows.push({ key: settingKey, value, origin: editor.describeOrigin(settingKey) });
        }
      }
    }

    for (const taskName of aiTaskNames) {
      const route: TaskAiConfigOverride | null = configBridge.getTaskAiConfigOverride(taskName);
      if (route === null) {
        continue;
      }

      const routeValues: Readonly<Record<string, string | null>> = {
        provider: route.providerId,
        model: route.model,
      };
      for (const [field, value] of Object.entries(routeValues)) {
        if (value !== null) {
          const settingKey: string = `tasks.${taskName}.${field}`;
          rows.push({ key: settingKey, value, origin: editor.describeOrigin(settingKey) });
        }
      }
    }

    for (const definition of storyboardSettingCatalog) {
      rows.push({
        key: definition.key,
        value: configBridge.getSettingValue(definition.key),
        origin: editor.describeOrigin(definition.key),
      });
    }

    const width: number = Math.max(...rows.map((row) => row.key.length));
    const lines: string[] = rows.map(
      (row) =>
        `${row.key.padEnd(width)}  ${String(row.value ?? '(없음)').padEnd(24)}  ${row.origin}`,
    );
    const files: string[] = [
      `공통 설정: ${container.homePaths.configFile}`,
      ...(container.workspaceConfigFile ? [`이 작품 설정: ${container.workspaceConfigFile}`] : []),
    ];

    return success([...files, '', ...lines].join('\n'), { rows, files });
  }
}
