import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { requiresApiKey, ConfigBridge, SecretStore } from '@storyboard/story-ai';
import { createFileSecretStorage, resolveStoryboardHomePaths } from '@storyboard/story-config';
import { inspectWorkspaceRepository } from '@storyboard/story-git';

import { ConfigError, loadConfig, type BotConfig } from '@/config/config';
import { collectCliProviderCommands, findExecutableOnPath } from '@/config/environment';
import { resolvePaths } from '@/config/paths';
import { createBotConfiguration, listProvidersInUse } from '@/config/sharedConfig';

class DoctorReport {
  private readonly lines: string[] = [];
  private failed = false;

  public ok(text: string): void {
    this.lines.push(`✅ ${text}`);
  }

  public warn(text: string): void {
    this.lines.push(`⚠️ ${text}`);
  }

  public fail(text: string): void {
    this.failed = true;
    this.lines.push(`❌ ${text}`);
  }

  public info(text: string): void {
    this.lines.push(`ℹ️ ${text}`);
  }

  public hint(text: string): void {
    this.lines.push(`   → ${text}`);
  }

  public render(): string {
    return this.lines.join('\n');
  }

  public get exitCode(): number {
    return this.failed ? 1 : 0;
  }
}

// The terminal counterpart of Telegram's /doctor, and the only one that answers before the bot can
// start: it must report a missing or broken config instead of depending on one.
export async function runDoctor(): Promise<number> {
  const report = new DoctorReport();

  const config = readBotConfig(resolvePaths().configFile, report);
  describeWorkspace(config, report);
  await describeProviders(config, report);

  process.stdout.write(`${report.render()}\n`);
  return report.exitCode;
}

function readBotConfig(configFile: string, report: DoctorReport): BotConfig | undefined {
  try {
    const loaded = loadConfig(configFile);
    report.ok(`설정 파일: ${configFile}`);
    for (const warning of loaded.warnings) {
      report.warn(warning);
    }
    return loaded.config;
  } catch (error) {
    if (!(error instanceof ConfigError)) {
      throw error;
    }

    if (error.code === 'not-found') {
      report.fail(`설정 파일이 없습니다: ${configFile}`);
      report.hint('`storyboard-bot setup` 으로 만들 수 있습니다.');
    } else {
      report.fail(`설정 파일 (${error.code}): ${error.message}`);
    }
    return undefined;
  }
}

function describeWorkspace(config: BotConfig | undefined, report: DoctorReport): void {
  if (config === undefined) {
    report.info('워크스페이스: 설정이 없어 확인하지 못했습니다.');
    return;
  }

  const root = config.workspace.path;
  if (!existsSync(join(root, '.storyboard', 'project.json'))) {
    report.fail(`워크스페이스: ${root} 에 .storyboard/project.json 이 없습니다.`);
    return;
  }
  report.ok(`워크스페이스: ${root}`);

  const repository = inspectWorkspaceRepository(root);
  if (repository.status === 'ready') {
    report.ok('git: 커밋 가능');
    return;
  }

  report.fail(`git: ${repository.detail}`);
  if (repository.status === 'needs-init') {
    report.hint('봇을 띄운 뒤 텔레그램에서 `/doctor init` 으로 초기화할 수 있습니다.');
  }
}

async function describeProviders(
  config: BotConfig | undefined,
  report: DoctorReport,
): Promise<void> {
  const home = resolveStoryboardHomePaths();

  if (existsSync(home.configFile)) {
    report.ok(`공용 설정: ${home.configFile}`);
  } else {
    report.warn(`공용 설정이 없습니다: ${home.configFile}`);
  }

  try {
    const configuration = createBotConfiguration({
      workspacePath: config?.workspace.path,
      providers: config?.providers,
      draft: config?.draft,
    });
    const configBridge = new ConfigBridge({ getConfiguration: () => configuration });

    if (!configBridge.isDefaultProviderConfigured()) {
      report.fail('프로바이더: 기본 AI 제공자가 없어 생성 작업이 거부됩니다.');
      report.hint(`${home.configFile} 의 defaultProvider 를 채우거나 setup 을 다시 실행하세요.`);
      return;
    }

    for (const { providerId, command } of collectCliProviderCommands(configBridge)) {
      const resolved = findExecutableOnPath(command);
      if (resolved === undefined) {
        report.fail(`프로바이더 ${providerId}: \`${command}\` 을 PATH 에서 찾을 수 없습니다.`);
      } else {
        report.ok(`프로바이더 ${providerId}: ${resolved}`);
      }
    }

    const secretStore = new SecretStore(createFileSecretStorage(home.secretsFile));
    for (const providerId of listProvidersInUse(configBridge)) {
      if (!requiresApiKey(providerId)) {
        continue;
      }
      if (await secretStore.hasApiKey(providerId)) {
        report.ok(`프로바이더 ${providerId}: API 키 있음`);
      } else {
        report.fail(`프로바이더 ${providerId}: ${home.secretsFile} 에 API 키가 없습니다.`);
      }
    }
  } catch (error) {
    report.fail(`설정을 읽는 중 실패했습니다: ${error instanceof Error ? error.message : error}`);
  }
}
