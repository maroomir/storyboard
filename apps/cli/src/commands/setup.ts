import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';

import {
  aiProviderIds,
  cliProviderIds,
  isCliProvider,
  requiresApiKey,
  storyboardModelCatalog,
  storyboardSettingCatalog,
  type AiProviderId,
  type ConfigBridge,
} from '@storyboard/story-ai';
import { getStoryboardProjectPaths } from '@storyboard/story-engine';

import { findExecutableOnPath } from '@/adapters/executablePath';
import { flagString } from '@/cliArguments';
import type { CliContainer } from '@/container';
import type { CommandContext, CommandOutcome } from './outcome';

const endOfText = '\u0003';
const deleteChar = '\u007f';

function isProviderId(value: string): value is AiProviderId {
  return aiProviderIds.includes(value as AiProviderId);
}

function describeProvider(providerId: AiProviderId): string {
  if (isCliProvider(providerId)) {
    return '구독 CLI · API 키 불필요';
  }
  if (providerId === 'ollama') {
    return '로컬';
  }
  if (providerId === 'mock') {
    return '가짜 텍스트 · 흐름 확인용';
  }
  return 'API 키 필요';
}

async function askLine(prompt: string): Promise<string> {
  const readline = createInterface({ input: process.stdin, output: process.stderr });

  try {
    return (await readline.question(prompt)).trim();
  } finally {
    readline.close();
  }
}

// Echo is switched off while the key is typed so it never lands in the scrollback.
async function askSecret(prompt: string): Promise<string> {
  process.stderr.write(prompt);
  const stdin = process.stdin;
  const wasRaw = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');

  return new Promise((resolve) => {
    let value = '';

    const cleanup = (): void => {
      stdin.off('data', onData);
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
    };

    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === endOfText) {
          cleanup();
          process.stderr.write('\n');
          process.exit(130);
        }
        if (char === '\r' || char === '\n') {
          cleanup();
          process.stderr.write('\n');
          resolve(value);
          return;
        }
        if (char === deleteChar || char === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };

    stdin.on('data', onData);
  });
}

async function chooseProviderInteractively(
  current: AiProviderId | undefined,
): Promise<AiProviderId | undefined> {
  process.stderr.write('Storyboard 가 기본으로 쓸 AI 프로바이더를 고르세요.\n');
  aiProviderIds.forEach((providerId, index) => {
    const marker = providerId === current ? ' (현재)' : '';
    process.stderr.write(
      `  ${index + 1}. ${providerId.padEnd(12)} ${describeProvider(providerId)}${marker}\n`,
    );
  });

  const answer = await askLine('번호 또는 이름 (엔터로 취소): ');

  if (answer.length === 0) {
    return undefined;
  }

  const byIndex = aiProviderIds[Number(answer) - 1];

  if (byIndex !== undefined) {
    return byIndex;
  }

  return isProviderId(answer) ? answer : undefined;
}

// `storyboard setup` — the terminal's version of the extension's provider picker. Interactive
// when there is a person at the keyboard; an agent passes `--provider` instead.
export async function runSetup({ container, args }: CommandContext): Promise<CommandOutcome> {
  const { configBridge, secretStore } = container;
  const flagProvider = flagString(args.flags, 'provider');
  const current = configBridge.isDefaultProviderConfigured()
    ? configBridge.getDefaultProvider()
    : undefined;

  let providerId: AiProviderId | undefined;

  if (flagProvider !== undefined) {
    providerId = flagProvider as AiProviderId;
  } else if (container.canPrompt) {
    providerId = await chooseProviderInteractively(current);
  } else {
    return {
      ok: false,
      message:
        '터미널이 아니어서 질문할 수 없습니다. `storyboard setup --provider <id>` 로 지정해 주세요.',
    };
  }

  if (providerId === undefined) {
    return { ok: false, message: '프로바이더를 고르지 않아 설정을 바꾸지 않았습니다.' };
  }

  await configBridge.setDefaultProvider(providerId);

  const model = flagString(args.flags, 'model');

  if (model !== undefined) {
    await configBridge.setProviderModel(providerId, model);
  }

  let keyStored = false;

  if (requiresApiKey(providerId) && !(await secretStore.hasApiKey(providerId))) {
    if (container.canPrompt) {
      const key = await askSecret(`${providerId} API 키 (비워 두면 나중에 apikey set 으로): `);

      if (key.trim().length > 0) {
        await secretStore.setApiKey(providerId, key);
        keyStored = true;
      }
    } else {
      process.stderr.write(
        `[warn] ${providerId} 는 API 키가 필요합니다: echo "$KEY" | storyboard apikey set ${providerId}\n`,
      );
    }
  }

  const home = container.homePaths;

  return {
    ok: true,
    message:
      `기본 프로바이더를 ${providerId} 로 저장했습니다: ${home.configFile}` +
      (keyStored ? `\nAPI 키를 저장했습니다: ${home.secretsFile}` : ''),
    data: { providerId, model: configBridge.getProviderConfig(providerId).model, keyStored },
  };
}

interface DoctorCheck {
  readonly status: 'ok' | 'warn' | 'fail' | 'info';
  readonly label: string;
  readonly detail: string;
  readonly fix?: string;
}

function statusIcon(status: DoctorCheck['status']): string {
  switch (status) {
    case 'ok':
      return '✅';
    case 'warn':
      return '⚠️';
    case 'fail':
      return '❌';
    case 'info':
      return 'ℹ️';
  }
}

async function collectProviderChecks(container: CliContainer): Promise<DoctorCheck[]> {
  const { configBridge, secretStore } = container;

  if (!configBridge.isDefaultProviderConfigured()) {
    return [
      {
        status: 'fail',
        label: '기본 프로바이더',
        detail: '설정되지 않았습니다. 생성 명령이 거부됩니다.',
        fix: 'storyboard setup',
      },
    ];
  }

  const providerId = configBridge.getDefaultProvider();
  const runtime = configBridge.getProviderConfig(providerId);
  const origin =
    configBridge.getValueOrigin('defaultProvider') === 'workspace' ? '이 작품' : '공통';
  const checks: DoctorCheck[] = [
    {
      status: 'ok',
      label: '기본 프로바이더',
      detail: `${providerId}${runtime.model ? ` · ${runtime.model}` : ''} (출처: ${origin})`,
    },
  ];

  if (requiresApiKey(providerId)) {
    checks.push(
      (await secretStore.hasApiKey(providerId))
        ? { status: 'ok', label: 'API 키', detail: `${providerId} 키가 있습니다.` }
        : {
            status: 'fail',
            label: 'API 키',
            detail: `${providerId} 키가 없습니다.`,
            fix: `echo "$KEY" | storyboard apikey set ${providerId}`,
          },
    );
  }

  if (isCliProvider(providerId)) {
    const command = runtime.command ?? providerId;
    const resolved = findExecutableOnPath(command);
    checks.push(
      resolved === undefined
        ? {
            status: 'fail',
            label: 'CLI 실행 파일',
            detail: `\`${command}\` 을 PATH 에서 찾을 수 없습니다.`,
            fix: `storyboard config set providers.${providerId}.command /절대/경로`,
          }
        : { status: 'ok', label: 'CLI 실행 파일', detail: resolved },
    );
  }

  return checks;
}

async function collectWorkspaceChecks(container: CliContainer): Promise<DoctorCheck[]> {
  const root = container.workspaceRoot;
  const paths = getStoryboardProjectPaths(root);

  if (!existsSync(paths.projectJson.fsPath)) {
    return [
      {
        status: 'warn',
        label: '워크스페이스',
        detail: `${root.fsPath} 는 Storyboard 워크스페이스가 아닙니다.`,
        fix: 'storyboard init --title "작품 이름"',
      },
    ];
  }

  const scenes = (await container.fileSystem.listFileNames(paths.sceneDirectory)).filter((name) =>
    name.endsWith('.card'),
  );
  const drafts = (await container.fileSystem.listFileNames(paths.draftDirectory)).filter((name) =>
    name.endsWith('.md'),
  );
  const hasOutline = existsSync(paths.outlineChapters.fsPath);

  return [
    { status: 'ok', label: '워크스페이스', detail: root.fsPath },
    {
      status: hasOutline ? 'ok' : 'info',
      label: '아웃라인',
      detail: hasOutline ? 'chapters.yaml 있음' : '아직 없음',
      ...(hasOutline ? {} : { fix: 'storyboard outline generate' }),
    },
    {
      status: scenes.length > 0 ? 'ok' : 'info',
      label: '씬',
      detail: `${scenes.length}개 (초안 ${drafts.length}개)`,
      ...(scenes.length > 0
        ? {}
        : { fix: 'storyboard scene seeds  또는  storyboard scene create --name <이름>' }),
    },
  ];
}

export async function runDoctor({ container }: CommandContext): Promise<CommandOutcome> {
  const home = container.homePaths;
  const hasUserConfig = existsSync(home.configFile);
  const workspaceConfig = container.workspaceConfigFile;
  const checks: DoctorCheck[] = [
    { status: 'info', label: 'Storyboard 홈', detail: home.home },
    {
      status: hasUserConfig ? 'ok' : 'info',
      label: '공통 설정',
      detail: hasUserConfig ? home.configFile : `${home.configFile} (아직 없음)`,
    },
    ...(workspaceConfig !== undefined && existsSync(workspaceConfig)
      ? [{ status: 'ok' as const, label: '이 작품 설정', detail: workspaceConfig }]
      : []),
    ...(await collectProviderChecks(container)),
    ...(await collectWorkspaceChecks(container)),
    { status: 'info', label: 'Node', detail: process.version },
  ];

  const failures = checks.filter((check) => check.status === 'fail');
  const lines = checks.map((check) => {
    const fix = check.fix ? `\n     → ${check.fix}` : '';
    return `${statusIcon(check.status)} ${check.label}: ${check.detail}${fix}`;
  });

  return {
    ok: failures.length === 0,
    message: lines.join('\n'),
    data: { checks },
  };
}

const configurableProviderKeys = [
  'model',
  'command',
  'baseUrl',
  'timeoutMs',
  'reasoningEffort',
] as const;

function describeOrigin(configBridge: ConfigBridge, key: string): string {
  switch (configBridge.getValueOrigin(key)) {
    case 'workspace':
      return '이 작품';
    case 'user':
      return '공통';
    default:
      return '기본값';
  }
}

export async function runConfigShow({ container }: CommandContext): Promise<CommandOutcome> {
  const { configBridge } = container;
  const rows: Array<{ key: string; value: unknown; origin: string }> = [
    {
      key: 'defaultProvider',
      value: configBridge.isDefaultProviderConfigured() ? configBridge.getDefaultProvider() : null,
      origin: describeOrigin(configBridge, 'defaultProvider'),
    },
  ];

  for (const providerId of aiProviderIds) {
    const runtime = configBridge.getProviderConfig(providerId);
    for (const key of configurableProviderKeys) {
      const value = runtime[key];
      if (value !== undefined) {
        const settingKey = `providers.${providerId}.${key}`;
        rows.push({ key: settingKey, value, origin: describeOrigin(configBridge, settingKey) });
      }
    }
  }

  for (const definition of storyboardSettingCatalog) {
    rows.push({
      key: definition.key,
      value: configBridge.getSettingValue(definition.key),
      origin: describeOrigin(configBridge, definition.key),
    });
  }

  const width = Math.max(...rows.map((row) => row.key.length));
  const lines = rows.map(
    (row) => `${row.key.padEnd(width)}  ${String(row.value ?? '(없음)').padEnd(24)}  ${row.origin}`,
  );
  const files = [
    `공통 설정: ${container.homePaths.configFile}`,
    ...(container.workspaceConfigFile ? [`이 작품 설정: ${container.workspaceConfigFile}`] : []),
  ];

  return { ok: true, message: [...files, '', ...lines].join('\n'), data: { rows, files } };
}

function parseSettingValue(
  kind: 'boolean' | 'integer' | 'string',
  raw: string,
): boolean | number | string | undefined {
  switch (kind) {
    case 'boolean':
      return raw === 'true' ? true : raw === 'false' ? false : undefined;
    case 'integer': {
      const parsed = Number.parseInt(raw, 10);
      return Number.isNaN(parsed) ? undefined : parsed;
    }
    case 'string':
      return raw;
  }
}

function describeSaved(container: CliContainer, key: string, value: unknown): CommandOutcome {
  const origin = container.configBridge.getValueOrigin(key);
  const file =
    origin === 'workspace' && container.workspaceConfigFile !== undefined
      ? container.workspaceConfigFile
      : container.homePaths.configFile;

  return {
    ok: true,
    message: `${key} = ${String(value)} 저장했습니다: ${file}`,
    data: { key, value, origin, file },
  };
}

async function setProviderField(
  container: CliContainer,
  providerId: AiProviderId,
  field: 'model' | 'command' | 'baseUrl',
  raw: string,
): Promise<CommandOutcome> {
  const { configBridge } = container;

  if (field === 'model') {
    const catalog = storyboardModelCatalog[providerId];
    if (!isCliProvider(providerId) && !catalog.some((entry) => entry.id === raw)) {
      return {
        ok: false,
        message: `${providerId} 에 없는 모델: ${raw}\n쓸 수 있는 값: ${catalog.map((entry) => entry.id).join(', ')}`,
      };
    }
    await configBridge.setProviderModel(providerId, raw);
  } else if (field === 'command') {
    if (!isCliProvider(providerId)) {
      return { ok: false, message: `command 는 ${cliProviderIds.join(', ')} 에만 있습니다.` };
    }
    await configBridge.setProviderCommand(providerId, raw);
  } else {
    if (providerId !== 'ollama') {
      return { ok: false, message: 'baseUrl 은 ollama 에만 있습니다.' };
    }
    await configBridge.setProviderBaseUrl(raw);
  }

  return describeSaved(container, `providers.${providerId}.${field}`, raw);
}

// `config set` is the agent-friendly face of the settings panel: one key, one value, validated by
// the same catalog the panel renders.
export async function runConfigSet({ container, args }: CommandContext): Promise<CommandOutcome> {
  const { configBridge } = container;
  const key = flagString(args.flags, 'key') ?? args.positionals[0];
  const raw = flagString(args.flags, 'value') ?? args.positionals[1];

  if (key === undefined || raw === undefined) {
    return { ok: false, message: '사용법: storyboard config set <key> <value>' };
  }

  if (key === 'defaultProvider') {
    if (!isProviderId(raw)) {
      return {
        ok: false,
        message: `알 수 없는 프로바이더: ${raw}\n쓸 수 있는 값: ${aiProviderIds.join(', ')}`,
      };
    }
    await configBridge.setDefaultProvider(raw);
    return describeSaved(container, key, raw);
  }

  const providerMatch = /^providers\.([a-z-]+)\.(model|command|baseUrl)$/.exec(key);

  if (providerMatch) {
    const providerId = providerMatch[1] ?? '';
    const field = providerMatch[2] as 'model' | 'command' | 'baseUrl';

    if (!isProviderId(providerId)) {
      return { ok: false, message: `알 수 없는 프로바이더: ${providerId}` };
    }

    return setProviderField(container, providerId, field, raw);
  }

  const definition = storyboardSettingCatalog.find((entry) => entry.key === key);

  if (!definition) {
    return {
      ok: false,
      message:
        `알 수 없는 설정 키: ${key}\n쓸 수 있는 키: defaultProvider, providers.<id>.model|command|baseUrl, ` +
        storyboardSettingCatalog.map((entry) => entry.key).join(', '),
    };
  }

  const value = parseSettingValue(definition.kind, raw);

  if (value === undefined) {
    return { ok: false, message: `${key} 는 ${definition.kind} 값이어야 합니다.` };
  }

  try {
    await configBridge.setSettingValue(key, value);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }

  return describeSaved(container, key, value);
}
