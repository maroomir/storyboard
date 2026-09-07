import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
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
import {
  auditStoryMemory,
  getStoryboardProjectPaths,
  loadNarratorCards,
  readProjectJson,
  resolveThreadPaths,
} from '@storyboard/story-engine';
import {
  formatSceneOrderRanges,
  findUnreadableStoryStateLines,
  isLegacySceneFileName,
  isInlineSceneSummary,
  isLegacySeedPlaceholderSummary,
  mainThreadId,
  readMissingGitignoreEntries,
  type SceneCard,
  type StoryboardProject,
} from '@storyboard/story-format';

import { findExecutableOnPath } from '@/adapters/executablePath';
import { flagString } from '@/cliArguments';
import type { CliContainer } from '@/container';
import type { CommandContext, CommandOutcome } from './outcome';
import { readSceneCards } from './sceneCards';

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

    if (resolved !== undefined) {
      checks.push(await checkCliProviderLogin(container, providerId));
    }
  }

  return checks;
}

// 실행 파일이 있어도 로그아웃 상태면 생성이 통째로 실패한다. 프로바이더가 이미 로그인 확인
// 방법을 알고 있으므로 doctor 에서 그대로 부른다.
async function checkCliProviderLogin(
  container: CliContainer,
  providerId: AiProviderId,
): Promise<DoctorCheck> {
  try {
    const result = await container.aiProviderRegistry.checkConnection(providerId);
    return result.ok
      ? { status: 'ok', label: '로그인', detail: `${providerId} 세션이 살아 있습니다.` }
      : {
          status: 'fail',
          label: '로그인',
          detail: `${providerId} CLI를 실행할 수 없습니다 (${result.reason}).`,
        };
  } catch (error) {
    return { status: 'fail', label: '로그인', detail: describeLoginFailure(error) };
  }
}

// 타임아웃·spawn 실패의 실제 원인은 cause 에 있다. 한 줄만 덧붙여 사용자가 무엇을 고칠지 알게 한다.
function describeLoginFailure(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const cause = error.cause instanceof Error ? ` (${error.cause.message})` : '';
  return `${error.message}${cause}`;
}

interface SceneCardCensus {
  readonly placeholders: number;
  readonly inlineSummaries: number;
  readonly withoutBeats: number;
  readonly unreadable: readonly string[];
  // 서술자·줄기 검사도 같은 카드를 본다. 한 번 읽어 두 진단이 나눠 쓴다.
  readonly cards: readonly { readonly fileName: string; readonly card: SceneCard }[];
}

async function surveySceneCards(
  container: CliContainer,
  sceneFileNames: readonly string[],
): Promise<SceneCardCensus> {
  const paths = getStoryboardProjectPaths(container.workspaceRoot);
  const { cards, unreadable } = await readSceneCards(
    container,
    paths.sceneDirectory,
    sceneFileNames,
  );
  const placeholders = cards.filter(({ card }) =>
    isLegacySeedPlaceholderSummary(card.summary),
  ).length;
  // 플레이스홀더는 인라인 summary 이기도 하지만 migrate 가 먼저 비우므로 따로 세지 않는다.
  const inlineSummaries = cards.filter(
    ({ card }) =>
      isInlineSceneSummary(card.summary) && !isLegacySeedPlaceholderSummary(card.summary),
  ).length;
  const withoutBeats = cards.filter(({ card }) => (card.beats?.length ?? 0) === 0).length;

  return { placeholders, inlineSummaries, withoutBeats, unreadable, cards };
}

// NOTE: 끊긴 서술자 참조와 정의되지 않은 줄기는 생성이 그 씬에 닿아야 드러난다. 장편은 그때가
// 수십 분 뒤이므로, 씬을 읽는 김에 미리 본다.
async function collectNarrationChecks(
  container: CliContainer,
  sceneCards: readonly { readonly fileName: string; readonly card: SceneCard }[],
): Promise<DoctorCheck[]> {
  const paths = getStoryboardProjectPaths(container.workspaceRoot);
  const narrators = await loadNarratorCards(paths, container.fileSystem);
  const project = await readProjectJson(container.fileSystem, paths.projectJson).catch(
    () => undefined,
  );
  const declaredThreads = new Set([...Object.keys(project?.setting?.threads ?? {}), mainThreadId]);

  const referencedNarrators = new Set(
    [
      ...sceneCards.map(({ card }) => card.narrator),
      project?.setting?.narration?.defaultNarrator,
    ].filter((id): id is string => id !== undefined),
  );
  const missingNarrators = [...referencedNarrators].filter((id) => !narrators.has(id));
  const unknownThreads = [
    ...new Set(
      sceneCards
        .map(({ card }) => card.thread)
        .filter((thread): thread is string => thread !== undefined)
        .filter((thread) => !declaredThreads.has(thread)),
    ),
  ];
  const focallessNarrators = [...narrators.values()].filter(
    (narrator) =>
      narrator.focal === undefined && (narrator.person === 'first' || narrator.person === 'second'),
  );
  const unreadableLedgerLines = await findUnreadableLedgerLines(container, project);

  return [
    ...(narrators.size > 0
      ? [
          {
            status: 'ok' as const,
            label: '서술자',
            detail: `${narrators.size}개 (${[...narrators.keys()].join(', ')})`,
          },
        ]
      : []),
    ...(missingNarrators.length > 0
      ? [
          {
            status: 'fail' as const,
            label: '서술자 참조',
            detail: `카드가 없는 서술자를 참조합니다 (${missingNarrators.join(', ')}). 그 씬은 생성되지 않습니다.`,
            fix: `storyboard narrator add ${missingNarrators[0]}`,
          },
        ]
      : []),
    ...(unknownThreads.length > 0
      ? [
          {
            status: 'warn' as const,
            label: '줄기',
            detail: `작품 계약에 없는 줄기를 씬이 참조합니다 (${unknownThreads.join(', ')}).`,
            fix: 'storyboard project set --composition omnibus --episodes <n>',
          },
        ]
      : []),
    ...(focallessNarrators.length > 0
      ? [
          {
            status: 'warn' as const,
            label: '서술자 초점',
            detail: `초점 인물이 없는 1·2인칭 서술자가 있습니다 (${focallessNarrators.map((narrator) => narrator.id).join(', ')}). 씬의 povCharacter 가 없으면 화자가 정해지지 않습니다.`,
          },
        ]
      : []),
    ...(unreadableLedgerLines.length > 0
      ? [
          {
            status: 'warn' as const,
            label: '이야기 상태',
            detail: `태그를 읽지 못한 원장 줄이 ${unreadableLedgerLines.length}개 있습니다 (예: ${unreadableLedgerLines[0]}). 그 항목은 시점 필터와 낡음 판정을 받지 못합니다.`,
            fix: '해당 줄을 `- [<씬 번호>] <내용>` 형태로 고쳐 주세요.',
          },
        ]
      : []),
  ];
}

// 줄기별 원장까지 함께 본다. 편이 갈린 작품에서 깨진 줄이 기본 원장에만 있으리라는 보장이 없다.
async function findUnreadableLedgerLines(
  container: CliContainer,
  project: StoryboardProject | undefined,
): Promise<string[]> {
  const paths = getStoryboardProjectPaths(container.workspaceRoot);
  const threadIds = Object.keys(project?.setting?.threads ?? {});
  const ledgerPaths = [
    paths.storyState,
    ...threadIds.map((threadId) => resolveThreadPaths(paths, threadId).storyState),
  ];

  const lines: string[] = [];
  for (const ledgerPath of ledgerPaths) {
    try {
      const content = new TextDecoder().decode(await container.fileSystem.readFile(ledgerPath));
      lines.push(...findUnreadableStoryStateLines(content));
    } catch {
      continue;
    }
  }

  return lines;
}

// 원장(.storyboard/memory/storyState.md)이 지금의 카드·씬과 어긋나는지 본다. 어긋난 채로 두면
// 폐기된 판본의 사실이 다음 씬 프롬프트로 들어간다.
async function collectStoryStateChecks(
  container: CliContainer,
  paths: ReturnType<typeof getStoryboardProjectPaths>,
): Promise<DoctorCheck[]> {
  if (!existsSync(paths.storyState.fsPath)) {
    return [];
  }

  const project = await readProjectJson(container.fileSystem, paths.projectJson).catch(
    () => undefined,
  );

  if (project === undefined) {
    return [];
  }

  const { audit } = await auditStoryMemory({
    fileSystem: container.fileSystem,
    paths,
    format: project.format,
    sceneBreakJoiner: container.configBridge.getDraftSceneBreakSeparator(),
  });

  if (audit.staleSceneOrders.length > 0) {
    return [
      {
        status: 'warn',
        label: '이야기 상태',
        detail: `씬 ${formatSceneOrderRanges(audit.staleSceneOrders)}의 항목 ${audit.staleEntryCount}개가 지금의 카드·씬과 어긋나 프롬프트에서 빠집니다.`,
        fix: `storyboard draft generate <씬 ${audit.staleSceneOrders[0] as number}부터 차례로>`,
      },
    ];
  }

  if (audit.unsealedSceneOrders.length > 0) {
    return [
      {
        status: 'info',
        label: '이야기 상태',
        detail: `씬 ${formatSceneOrderRanges(audit.unsealedSceneOrders)}에 입력 기록이 없어 낡음을 판정할 수 없습니다.`,
        fix: 'storyboard init --repair',
      },
    ];
  }

  return [{ status: 'ok', label: '이야기 상태', detail: '원장이 지금의 카드·씬과 맞습니다.' }];
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

  // 0.8 이전 워크스페이스나 손으로 지운 디렉터리는 진단 대상이지 예외가 아니다.
  const sceneFileNames = await container.fileSystem
    .listFileNames(paths.sceneDirectory)
    .catch(() => []);
  const scenes = sceneFileNames.filter((name) => name.endsWith('.card'));
  const legacyScenes = sceneFileNames.filter((name) => isLegacySceneFileName(name));
  const drafts = (
    await container.fileSystem.listFileNames(paths.draftDirectory).catch(() => [])
  ).filter((name) => name.endsWith('.md'));
  const missingDirectories = [paths.sceneDirectory, paths.draftDirectory]
    .filter((uri) => !existsSync(uri.fsPath))
    .map((uri) => `${basename(uri.fsPath)}/`);
  const hasOutline = existsSync(paths.outlineChapters.fsPath);
  const {
    placeholders: placeholderScenes,
    inlineSummaries,
    withoutBeats,
    unreadable,
    cards: sceneCards,
  } = await surveySceneCards(container, scenes);
  const missingIgnoreEntries = readMissingGitignoreEntries(
    existsSync(paths.gitignore.fsPath) ? readFileSync(paths.gitignore.fsPath, 'utf8') : undefined,
  );

  return [
    { status: 'ok', label: '워크스페이스', detail: root.fsPath },
    ...(missingDirectories.length > 0
      ? [
          {
            status: 'warn' as const,
            label: '디렉터리',
            detail: `${missingDirectories.join(', ')} 이(가) 없습니다.`,
            fix: 'storyboard init --repair',
          },
        ]
      : []),
    ...(legacyScenes.length > 0
      ? [
          {
            status: 'warn' as const,
            label: '구형 씬',
            detail: `scene/*.txt 가 ${legacyScenes.length}개 남아 있어 읽히지 않습니다.`,
            fix: 'storyboard scene migrate',
          },
        ]
      : []),
    ...(unreadable.length > 0
      ? [
          {
            status: 'warn' as const,
            label: '씬 카드',
            detail: `읽지 못한 카드가 있습니다 (${unreadable.join(', ')}).`,
          },
        ]
      : []),
    ...(placeholderScenes > 0
      ? [
          {
            status: 'warn' as const,
            label: '씬 요약',
            detail: `0.8 이전 플레이스홀더 요약이 ${placeholderScenes}개 남아 있어 초안이 안내 문구로 쓰입니다.`,
            fix: 'storyboard scene migrate',
          },
        ]
      : []),
    ...(inlineSummaries > 0
      ? [
          {
            status: 'warn' as const,
            label: '씬 요약',
            detail: `인라인 summary 씬이 ${inlineSummaries}개 있습니다. summary 는 <stem>.summary.md 파일로 둡니다.`,
            fix: 'storyboard scene migrate',
          },
        ]
      : []),
    ...(withoutBeats > 0
      ? [
          {
            status: 'warn' as const,
            label: '씬 비트',
            detail: `비트 없는 씬이 ${withoutBeats}개 있습니다. 생성 시 자동으로 채우지만 미리 검수하려면 뽑아 두세요.`,
            fix: 'storyboard scene beats --all',
          },
        ]
      : []),
    ...(await collectStoryStateChecks(container, paths)),
    ...(missingIgnoreEntries.length > 0
      ? [
          {
            status: 'warn' as const,
            label: '.gitignore',
            detail: `생성물 항목이 빠졌습니다 (${missingIgnoreEntries.join(', ')}).`,
            fix: 'storyboard init --repair',
          },
        ]
      : []),
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
    ...(await collectNarrationChecks(container, sceneCards)),
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
