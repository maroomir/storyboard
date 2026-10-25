import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

import {
  aiTaskNames,
  getProviderTransport,
  listSelectableProviderIds,
  isHiddenProvider,
  isModelInCatalogForProvider,
  requiresApiKey,
  storyboardModelCatalog,
  storyboardSettingCatalog,
  type AiProviderId,
  type AiTaskName,
  formatSceneOrderRanges,
  backgroundCardRelativePath,
  findUnknownBeatCast,
  formatBackgroundFactConflict,
  findUnreadableStoryStateLines,
  flattenChapterPlan,
  mainThreadId,
  parseSceneFileName,
  parseSceneRenameJournal,
  parseSceneStem,
  readChapterPlanFile,
  readMissingGitignoreEntries,
  type SceneCard,
  type StoryboardProject,
  type StoryboardSettingDefinition,
  type StoryboardSettingKind,
  decimalSettingStep,
  getStoryboardProjectPaths,
  isOnDecimalStep,
  resolveThreadPaths,
  type StoryboardProjectPaths,
  type StoryUri,
  type SceneRename,
  type SidebarCardSummary,
  type NarratorCard,
  type ModelMeasurement,
  type ConfigValueOrigin,
} from '@storyboard/story-model';
import {
  type ConfigBridge,
  type ProviderModelConfig,
  type TaskAiConfigOverride,
} from '@storyboard/story-ai';
import {
  auditChapterMemory,
  auditStoryMemory,
  loadNarratorCards,
  readProjectJson,
} from '@storyboard/story-engine';

import { isGitRepository } from '@/adapters/gitRepository';
import { flagString } from '@/cliArguments';
import type { CliContainer } from '@/container';
import { renderBox, renderColumns, type ColumnRow } from '@/terminal/layout';
import type { TerminalStream } from '@/terminal/profile';
import type { ThemeRole } from '@/terminal/theme';
import { measureWidth } from '@/terminal/width';
import type {
  CardReading,
  ParameterEntry,
  ParameterOrigin,
  ParameterReport,
  ResourceOverrideReport,
} from '@storyboard/story-app';
import type { CommandContext, CommandOutcome } from './outcome';
import { collectHiddenProviderChecks, setHiddenProviderKey } from './hiddenProvider';
import { signIn } from './login';
import { askLine, askSecret } from './prompt';
import { readSceneCards } from './sceneCards';
import { providerKeys, type ProviderKey } from './catalog';
import { availableProviderIds, enabledHiddenProviderIds } from '@/adapters/availableProviders';
import type { StoryboardHomePaths } from '@storyboard/story-config';
import type { BackgroundFactConflictReport } from '../../../../packages/story-app/src/managers/cardManager';

function isProviderId(value: string): value is AiProviderId {
  return availableProviderIds().includes(value as AiProviderId);
}

function describeProvider(providerId: AiProviderId): string {
  if (providerId === 'ollama') {
    return '로컬';
  }
  if (providerId === 'mock') {
    return '가짜 텍스트 · 흐름 확인용';
  }
  if (!requiresApiKey(providerId)) {
    return '구독 로그인';
  }
  return 'API 키 필요';
}

async function chooseProviderInteractively(
  current: AiProviderId | undefined,
): Promise<AiProviderId | undefined> {
  const selectableProviderIds: AiProviderId[] = listSelectableProviderIds(
    current,
    enabledHiddenProviderIds(),
  );

  process.stderr.write('Storyboard 가 기본으로 쓸 AI 프로바이더를 고르세요.\n');
  selectableProviderIds.forEach((providerId, index) => {
    const marker: '' | ' (현재)' = providerId === current ? ' (현재)' : '';
    process.stderr.write(
      `  ${index + 1}. ${providerId.padEnd(12)} ${describeProvider(providerId)}${marker}\n`,
    );
  });

  const answer: string = await askLine('번호 또는 이름 (엔터로 취소): ');

  if (answer.length === 0) {
    return undefined;
  }

  const byIndex: AiProviderId | undefined = selectableProviderIds[Number(answer) - 1];

  if (byIndex !== undefined) {
    return byIndex;
  }

  return selectableProviderIds.find((providerId) => providerId === answer);
}

export async function runSetup({ container, args }: CommandContext): Promise<CommandOutcome> {
  const { configBridge, secretStore } = container;
  const flagProvider: string | undefined = flagString(args.flags, 'provider');
  const current: AiProviderId | undefined = configBridge.isDefaultProviderConfigured()
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

  const model: string | undefined = flagString(args.flags, 'model');

  if (model !== undefined) {
    await configBridge.setProviderModel(providerId, model);
  }

  let keyStored: boolean = false;

  if (requiresApiKey(providerId) && !(await secretStore.hasApiKey(providerId))) {
    if (container.canPrompt) {
      const key: string = await askSecret(
        `${providerId} API 키 (비워 두면 나중에 apikey set 으로): `,
      );

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

  const home: StoryboardHomePaths = container.homePaths;
  const loginNote: CommandOutcome | undefined = await signInIfNeeded(container, providerId);

  if (loginNote !== undefined && !loginNote.ok) {
    return loginNote;
  }

  return {
    ok: true,
    message:
      `기본 프로바이더를 ${providerId} 로 저장했습니다: ${container.configWriteFile}` +
      (keyStored ? `\nAPI 키를 저장했습니다: ${home.secretsFile}` : '') +
      (loginNote === undefined ? '' : `\n${loginNote.message}`),
    data: {
      providerId,
      model: configBridge.getProviderConfig(providerId).model,
      keyStored,
      file: container.configWriteFile,
    },
  };
}

async function signInIfNeeded(
  container: CliContainer,
  providerId: AiProviderId,
): Promise<CommandOutcome | undefined> {
  if (getProviderTransport(providerId) !== 'oauth') {
    return undefined;
  }

  if ((await container.secretStore.getOAuthConnection(providerId))?.tokens !== undefined) {
    return undefined;
  }

  return container.canPrompt
    ? signIn(container, providerId)
    : { ok: true, message: `${providerId} 는 로그인이 필요합니다: storyboard login ${providerId}` };
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

  const providerId: AiProviderId = configBridge.getDefaultProvider();
  const runtime: ProviderModelConfig = configBridge.getProviderConfig(providerId);
  const origin: '이 작품' | '공통' =
    configBridge.getValueOrigin('ai.provider.default') === 'workspace' ? '이 작품' : '공통';
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

  if (isHiddenProvider(providerId)) {
    checks.push(...(await collectHiddenProviderChecks(container, providerId)));
  }

  return checks;
}

interface SceneCardCensus {
  readonly withoutBeats: number;
  readonly unreadable: readonly string[];
  readonly cards: readonly { readonly fileName: string; readonly card: SceneCard }[];
  readonly largestSceneTarget: number;
}

const largeSceneTarget: number = 8_000;
const acceptableReach: number = 0.8;

function collectSceneLengthReachChecks(
  container: CliContainer,
  largestSceneTarget: number,
): DoctorCheck[] {
  const { configBridge } = container;

  if (largestSceneTarget < largeSceneTarget || !configBridge.isDefaultProviderConfigured()) {
    return [];
  }

  const providerId: AiProviderId = configBridge.getDefaultProvider();
  const model: string | undefined = configBridge.getProviderConfig(providerId).model;
  const measured: ModelMeasurement | undefined = configBridge.getModelProfile()?.measured;

  if (measured === undefined || measured.reach >= acceptableReach) {
    return [];
  }

  const reach: number = measured.reach;

  return [
    {
      status: 'warn',
      label: '모델과 목표 분량',
      detail:
        `씬 목표가 최대 ${largestSceneTarget.toLocaleString('en-US')}자인데 ${providerId} · ${model} 은 ` +
        `실측상 그런 씬에서 목표의 ${Math.round(reach * 100)}% 정도까지만 씁니다` +
        ` (${measured.date} · ${measured.workspace} · ${measured.runs}회). ` +
        '구간 상한을 1000 근처로 낮추면 실측상 40% 남짓 늘지만, 그래도 목표에는 못 미칩니다.',
      fix: 'storyboard config set generation.section.outputLimit 1000',
    },
  ];
}

async function surveySceneCards(
  container: CliContainer,
  sceneFileNames: readonly string[],
): Promise<SceneCardCensus> {
  const paths: StoryboardProjectPaths = getStoryboardProjectPaths(container.workspaceRoot);
  const { cards, unreadable } = await readSceneCards(
    container,
    paths.sceneDirectory,
    sceneFileNames,
  );
  const withoutBeats: number = cards.filter(({ card }) => (card.beats?.length ?? 0) === 0).length;
  const largestSceneTarget: number = cards.reduce(
    (largest, { card }) => Math.max(largest, card.targetWordCount ?? 0),
    0,
  );

  return { withoutBeats, unreadable, cards, largestSceneTarget };
}

async function collectNarrationChecks(
  container: CliContainer,
  sceneCards: readonly { readonly fileName: string; readonly card: SceneCard }[],
): Promise<DoctorCheck[]> {
  const paths: StoryboardProjectPaths = getStoryboardProjectPaths(container.workspaceRoot);
  const narrators: ReadonlyMap<string, NarratorCard> = await loadNarratorCards(
    paths,
    container.fileSystem,
  );
  const project: StoryboardProject | undefined = await readProjectJson(
    container.fileSystem,
    paths.projectJson,
  ).catch(() => undefined);
  const declaredThreads: Set<string> = new Set([
    ...Object.keys(project?.setting?.threads ?? {}),
    mainThreadId,
  ]);

  const referencedNarrators: Set<string> = new Set(
    [
      ...sceneCards.map(({ card }) => card.narrator),
      project?.setting?.narration?.defaultNarrator,
    ].filter((id): id is string => id !== undefined),
  );
  const missingNarrators: string[] = [...referencedNarrators].filter((id) => !narrators.has(id));
  const unknownThreads: string[] = [
    ...new Set(
      sceneCards
        .map(({ card }) => card.thread)
        .filter((thread): thread is string => thread !== undefined)
        .filter((thread) => !declaredThreads.has(thread)),
    ),
  ];
  const focallessNarrators: NarratorCard[] = [...narrators.values()].filter(
    (narrator) =>
      narrator.focal === undefined && (narrator.person === 'first' || narrator.person === 'second'),
  );
  const unreadableLedgerLines: string[] = await findUnreadableLedgerLines(container, project);
  const narrationlessScenes: string[] = await findNarrationlessScenes(
    container,
    sceneCards,
    project,
  );

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
            fix: `storyboard narrator create ${missingNarrators[0]}`,
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
    ...(narrationlessScenes.length > 0
      ? [
          {
            status: 'warn' as const,
            label: '시점',
            detail: `povCharacter 가 있는 씬 ${narrationlessScenes.length}개에 시점이 없습니다 (예: ${narrationlessScenes[0]}). 작품 계약의 pov 도 서술자도 없으면 시점 지시 없이 생성돼 3인칭으로 흐릅니다.`,
            fix: 'storyboard project set --pov first',
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

async function findNarrationlessScenes(
  container: CliContainer,
  sceneCards: readonly { readonly fileName: string; readonly card: SceneCard }[],
  project: StoryboardProject | undefined,
): Promise<string[]> {
  if (project?.setting?.pov !== undefined || project?.setting?.narration?.defaultNarrator) {
    return [];
  }

  const paths: StoryboardProjectPaths = getStoryboardProjectPaths(container.workspaceRoot);
  const chapterNarrators: (string | undefined)[] = await readChapterPlanFile(
    paths.outlineChapters,
    container.fileSystem,
  )
    .then((plan) => flattenChapterPlan(plan).map((placement) => placement.chapterNarrator))
    .catch(() => [] as (string | undefined)[]);

  return sceneCards
    .filter(({ card }) => card.povCharacter !== undefined && card.narrator === undefined)
    .filter(({ card }) => {
      const order: number | undefined = parseSceneStem(card.id)?.order;
      return order === undefined || chapterNarrators[order - 1] === undefined;
    })
    .map(({ card }) => card.id);
}

async function findUnreadableLedgerLines(
  container: CliContainer,
  project: StoryboardProject | undefined,
): Promise<string[]> {
  const paths: StoryboardProjectPaths = getStoryboardProjectPaths(container.workspaceRoot);
  const threadIds: string[] = Object.keys(project?.setting?.threads ?? {});
  const ledgerPaths: StoryUri[] = [
    paths.storyState,
    ...threadIds.map((threadId) => resolveThreadPaths(paths, threadId).storyState),
  ];

  const lines: string[] = [];
  for (const ledgerPath of ledgerPaths) {
    try {
      const content: string = new TextDecoder().decode(
        await container.fileSystem.readFile(ledgerPath),
      );
      lines.push(...findUnreadableStoryStateLines(content));
    } catch {
      continue;
    }
  }

  return lines;
}

async function collectStoryStateChecks(
  container: CliContainer,
  paths: ReturnType<typeof getStoryboardProjectPaths>,
): Promise<DoctorCheck[]> {
  if (!existsSync(paths.storyState.fsPath)) {
    return [];
  }

  const project: StoryboardProject | undefined = await readProjectJson(
    container.fileSystem,
    paths.projectJson,
  ).catch(() => undefined);

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
        fix: 'storyboard draft generate --all',
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

async function collectChapterSummaryChecks(
  container: CliContainer,
  paths: ReturnType<typeof getStoryboardProjectPaths>,
): Promise<DoctorCheck[]> {
  if (!existsSync(paths.chapterSummaries.fsPath)) {
    return [];
  }

  const { audit } = await auditChapterMemory({ fileSystem: container.fileSystem, paths });

  if (audit.summaries.length === 0) {
    return [];
  }

  if (audit.staleChapterTitles.length > 0) {
    return [
      {
        status: 'warn',
        label: '장별 요약',
        detail: `${audit.staleChapterTitles.join(', ')}의 요약이 지금의 초안과 어긋나 프롬프트에서 빠집니다.`,
        fix: 'storyboard manuscript summarize',
      },
    ];
  }

  if (audit.unsealedChapterTitles.length > 0) {
    return [
      {
        status: 'info',
        label: '장별 요약',
        detail: `${audit.unsealedChapterTitles.join(', ')}에 초안 기록이 없어 낡음을 판정할 수 없습니다.`,
        fix: 'storyboard manuscript summarize',
      },
    ];
  }

  return [{ status: 'ok', label: '장별 요약', detail: '요약이 지금의 초안과 맞습니다.' }];
}

function collectInterruptedRenameChecks(
  paths: ReturnType<typeof getStoryboardProjectPaths>,
  sceneFileNames: readonly string[],
  draftFileNames: readonly string[],
): DoctorCheck[] {
  const cardStems: Set<string> = new Set(
    sceneFileNames.flatMap((fileName) => parseSceneFileName(fileName)?.stem ?? []),
  );
  const journal: SceneRename | undefined = existsSync(paths.sceneRenameJournal.fsPath)
    ? parseSceneRenameJournal(readFileSync(paths.sceneRenameJournal.fsPath, 'utf8'))
    : undefined;
  const cutOffRename: SceneRename | undefined =
    journal !== undefined && cardStems.has(journal.from.stem) ? journal : undefined;

  const orphanFiles: string[] = [
    ...draftFileNames
      .map((fileName) => fileName.replace(/\.md$/, ''))
      .filter((stem) => parseSceneStem(stem) !== undefined && !cardStems.has(stem))
      .map((stem) => `draft/${stem}.md`),
    ...sceneFileNames
      .filter((fileName) => fileName.endsWith('.summary.md'))
      .filter((fileName) => !cardStems.has(fileName.replace(/\.summary\.md$/, '')))
      .map((fileName) => `scene/${fileName}`),
  ];

  return [
    ...(cutOffRename !== undefined
      ? [
          {
            status: 'fail' as const,
            label: '씬 이름 바꾸기',
            detail: `${cutOffRename.from.stem} → ${cutOffRename.to.stem} 가 끝나지 않아 옛 카드가 남아 있습니다.`,
            fix: `storyboard scene rename ${cutOffRename.from.stem} --to ${cutOffRename.to.stem}`,
          },
        ]
      : []),
    ...(orphanFiles.length > 0
      ? [
          {
            status: 'warn' as const,
            label: '카드 없는 씬 파일',
            detail: `${orphanFiles.join(', ')} 의 씬 카드가 없습니다.`,
            fix: '끊긴 씬 이름 바꾸기가 남긴 옛 파일이면 지우고, 아니면 카드를 되살리세요 (git으로 되돌릴 수 있습니다).',
          },
        ]
      : []),
  ];
}

async function collectWorkspaceChecks(container: CliContainer): Promise<DoctorCheck[]> {
  const root: StoryUri = container.workspaceRoot;
  const paths: StoryboardProjectPaths = getStoryboardProjectPaths(root);

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

  const sceneFileNames: readonly string[] = await container.fileSystem
    .listFileNames(paths.sceneDirectory)
    .catch(() => []);
  const scenes: string[] = sceneFileNames.filter((name) => name.endsWith('.card'));
  const drafts: string[] = (
    await container.fileSystem.listFileNames(paths.draftDirectory).catch(() => [])
  ).filter((name) => name.endsWith('.md'));
  const missingDirectories: string[] = [paths.sceneDirectory, paths.draftDirectory]
    .filter((uri) => !existsSync(uri.fsPath))
    .map((uri) => `${basename(uri.fsPath)}/`);
  const hasOutline: boolean = existsSync(paths.outlineChapters.fsPath);
  const {
    withoutBeats,
    unreadable,
    cards: sceneCards,
    largestSceneTarget,
  } = await surveySceneCards(container, scenes);
  const missingIgnoreEntries: readonly string[] = readMissingGitignoreEntries(
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
    ...collectInterruptedRenameChecks(paths, sceneFileNames, drafts),
    ...(unreadable.length > 0
      ? [
          {
            status: 'warn' as const,
            label: '씬 카드',
            detail: `읽지 못한 카드가 있습니다 (${unreadable.join(', ')}).`,
          },
        ]
      : []),
    ...(withoutBeats > 0
      ? [
          {
            status: 'warn' as const,
            label: '씬 비트',
            detail: `비트 없는 씬이 ${withoutBeats}개 있습니다. 생성 시 자동으로 채우지만 미리 검수하려면 뽑아 두세요.`,
            fix: 'storyboard scene plot --all',
          },
        ]
      : []),
    ...collectSceneLengthReachChecks(container, largestSceneTarget),
    ...(await collectStoryStateChecks(container, paths)),
    ...(await collectChapterSummaryChecks(container, paths)),
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
    isGitRepository(root.fsPath)
      ? { status: 'ok' as const, label: 'git', detail: '저장소 있음' }
      : {
          status: 'warn' as const,
          label: 'git',
          detail: '워크스페이스가 git 저장소가 아닙니다.',
          fix: 'storyboard init --repair',
        },
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
        : { fix: 'storyboard scene seed  또는  storyboard scene create --name <이름>' }),
    },
    ...(await collectNarrationChecks(container, sceneCards)),
    ...(await collectBeatCastChecks(container, sceneCards)),
    ...(await collectCachedBackgroundConflictChecks(container)),
  ];
}

async function collectBeatCastChecks(
  container: CliContainer,
  sceneCards: readonly { readonly fileName: string; readonly card: SceneCard }[],
): Promise<DoctorCheck[]> {
  const hasCast: boolean = sceneCards.some(({ card }) =>
    (card.beats ?? []).some((beat) => typeof beat !== 'string' && (beat.cast?.length ?? 0) > 0),
  );
  if (!hasCast) {
    return [];
  }

  const summaries: SidebarCardSummary[] = await container.cards.list(
    container.workspaceRoot,
    'character',
  );
  const characters: { id: string; name: string; aliases: readonly string[] }[] = [];
  for (const summary of summaries) {
    const reading: CardReading | undefined = await container.cards.read(
      container.workspaceRoot,
      summary.id,
    );
    const aliases: string[] =
      reading?.card.type === 'character' ? (reading.card.aliases ?? []) : [];
    characters.push({ id: summary.id, name: summary.name, aliases });
  }

  const unknown: string[] = sceneCards.flatMap(({ fileName, card }) =>
    findUnknownBeatCast(card.beats, characters).map(
      ({ beat, ref }) => `${fileName.replace(/\.card$/, '')} 비트 ${beat}: ${ref}`,
    ),
  );

  return unknown.length === 0
    ? []
    : [
        {
          status: 'warn',
          label: '비트 출연',
          detail: `인물 카드의 id·이름·별칭과 맞지 않는 출연이 있습니다 (${unknown.join(', ')}). 이름으로 바뀌지 않고 그대로 프롬프트에 실립니다.`,
          fix: 'storyboard card list character',
        },
      ];
}

async function collectCachedBackgroundConflictChecks(
  container: CliContainer,
): Promise<DoctorCheck[]> {
  const reports: BackgroundFactConflictReport[] = await container.cards.listBackgroundFactConflicts(
    container.workspaceRoot,
  );

  return reports.map((report) => ({
    status: 'warn' as const,
    label: '배경 사실 상충',
    detail: `${report.cardId}: ${report.conflicts.map(formatBackgroundFactConflict).join(', ')}는 함께 참일 수 없습니다. 생성은 사건에 맞는 쪽만 씁니다.`,
    fix: `${backgroundCardRelativePath(report.cardId)}에서 하나를 지우거나 고치세요`,
  }));
}

async function collectResourceChecks(container: CliContainer): Promise<DoctorCheck[]> {
  const report: ResourceOverrideReport = await container.loadResourceOverrides();

  return [
    ...report.applied.map((entry) => ({
      status: 'ok' as const,
      label: `리소스 파일 (${entry.kind})`,
      detail: entry.file.fsPath,
    })),
    ...report.problems.map((problem) => ({
      status: 'fail' as const,
      label: '리소스 파일',
      detail: problem.message,
      fix: '파일을 고치거나 지우세요. 고칠 때까지 번들 기본값이 쓰입니다.',
    })),
  ];
}

interface DoctorSection {
  readonly title: string;
  readonly checks: readonly DoctorCheck[];
}

export async function runDoctor({ container, stdout }: CommandContext): Promise<CommandOutcome> {
  const home: StoryboardHomePaths = container.homePaths;
  const hasUserConfig: boolean = existsSync(home.configFile);
  const workspaceConfig: string | undefined = container.workspaceConfigFile;
  const homeChecks: DoctorCheck[] = [
    { status: 'info', label: 'Storyboard 홈', detail: home.home },
    {
      status: hasUserConfig ? 'ok' : 'info',
      label: '공통 설정',
      detail: hasUserConfig ? home.configFile : `${home.configFile} (아직 없음)`,
    },
    ...(workspaceConfig !== undefined && existsSync(workspaceConfig)
      ? [{ status: 'ok' as const, label: '이 작품 설정', detail: workspaceConfig }]
      : []),
  ];
  const nodeCheck: DoctorCheck = { status: 'info', label: 'Node', detail: process.version };
  const sections: DoctorSection[] = [
    { title: '환경', checks: [...homeChecks, nodeCheck] },
    { title: 'AI', checks: await collectProviderChecks(container) },
    { title: '리소스 파일', checks: await collectResourceChecks(container) },
    { title: '작품', checks: await collectWorkspaceChecks(container) },
  ];
  const checks: DoctorCheck[] = [
    ...homeChecks,
    ...sections.slice(1).flatMap((section) => section.checks),
    nodeCheck,
  ];

  const isDrawn: boolean = stdout?.isTty === true;

  return {
    ok: !checks.some((check) => check.status === 'fail'),
    message:
      isDrawn && stdout !== undefined
        ? renderDoctorPanels(sections, stdout).join('\n')
        : checks.map(renderDoctorLine).join('\n'),
    data: { checks },
    isDrawn,
  };
}

function renderDoctorLine(check: DoctorCheck): string {
  const fix: string = check.fix ? `\n     → ${check.fix}` : '';
  return `${statusIcon(check.status)} ${check.label}: ${check.detail}${fix}`;
}

const doctorMarks: Readonly<
  Record<DoctorCheck['status'], readonly [mark: string, role: ThemeRole]>
> = {
  ok: ['✓', 'success'],
  warn: ['▲', 'warning'],
  fail: ['✗', 'danger'],
  info: ['·', 'muted'],
};

const doctorPanelWidth: number = 100;

function renderDoctorPanels(sections: readonly DoctorSection[], stream: TerminalStream): string[] {
  const { paint } = stream.theme;
  const visibleSections: DoctorSection[] = sections.filter((section) => section.checks.length > 0);
  const allChecks: DoctorCheck[] = visibleSections.flatMap((section) => section.checks);
  const innerWidth: number = Math.min(stream.columns, doctorPanelWidth) - 4;
  const labelWidth: number = Math.max(...allChecks.map((check) => measureWidth(check.label))) + 2;

  const describeCheck = (check: DoctorCheck): ColumnRow => {
    const [mark, role] = doctorMarks[check.status];
    const fix: string = check.fix === undefined ? '' : `\n${paint('muted', `→ ${check.fix}`)}`;
    return { label: `${paint(role, mark)} ${check.label}`, description: `${check.detail}${fix}` };
  };

  const panels: string[] = visibleSections.flatMap((section) =>
    renderBox(
      renderColumns(section.checks.map(describeCheck), {
        availableWidth: innerWidth,
        indent: 0,
        labelWidth,
      }),
      {
        availableWidth: stream.columns,
        innerWidth,
        title: section.title,
        paintFrame: (text) => paint('muted', text),
        paintTitle: (text) => paint('heading', text),
      },
    ),
  );

  const count = (status: DoctorCheck['status']): number =>
    allChecks.filter((check) => check.status === status).length;
  const summary: string = [
    paint('success', `통과 ${count('ok')}`),
    paint('warning', `경고 ${count('warn')}`),
    paint('danger', `실패 ${count('fail')}`),
  ].join(paint('muted', ' · '));
  const firstFix: DoctorCheck | undefined =
    allChecks.find((check) => check.status === 'fail' && check.fix !== undefined) ??
    allChecks.find((check) => check.status === 'warn' && check.fix !== undefined);

  return [
    ...panels,
    ` ${summary}`,
    ...(firstFix?.fix === undefined ? [] : [` ${paint('muted', '먼저 →')}  ${firstFix.fix}`]),
  ];
}

function describeOrigin(configBridge: ConfigBridge, key: string): string {
  switch (configBridge.getValueOrigin(key)) {
    case 'workspace':
      return '이 작품';
    case 'user':
      return '공통';
    default:
      return configBridge.getModelProfileDefault(key) === undefined ? '기본값' : '모델 실측';
  }
}

export async function runConfigShow({ container }: CommandContext): Promise<CommandOutcome> {
  const { configBridge } = container;
  const rows: Array<{ key: string; value: unknown; origin: string }> = [
    {
      key: 'ai.provider.default',
      value: configBridge.isDefaultProviderConfigured() ? configBridge.getDefaultProvider() : null,
      origin: describeOrigin(configBridge, 'ai.provider.default'),
    },
  ];

  for (const providerId of availableProviderIds()) {
    const runtime: ProviderModelConfig = configBridge.getProviderConfig(providerId);
    for (const key of providerKeys) {
      const value: string | number | undefined = runtime[key];
      if (value !== undefined) {
        const settingKey: string = `providers.${providerId}.${key}`;
        rows.push({ key: settingKey, value, origin: describeOrigin(configBridge, settingKey) });
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

  const width: number = Math.max(...rows.map((row) => row.key.length));
  const lines: string[] = rows.map(
    (row) => `${row.key.padEnd(width)}  ${String(row.value ?? '(없음)').padEnd(24)}  ${row.origin}`,
  );
  const files: string[] = [
    `공통 설정: ${container.homePaths.configFile}`,
    ...(container.workspaceConfigFile ? [`이 작품 설정: ${container.workspaceConfigFile}`] : []),
  ];

  return { ok: true, message: [...files, '', ...lines].join('\n'), data: { rows, files } };
}

const parameterKindLabels: Record<ParameterEntry['kind'], string> = {
  setting: '설정 (config.json)',
  generation: '생성 손잡이 (모델 실측 → 파이프라인 기본값)',
  prompt: '프롬프트 온도·출력 상한 (프롬프트 파일 머리말)',
};

const parameterOriginLabels: Record<ParameterEntry['origin'], string> = {
  workspace: '이 작품',
  user: '공통',
  model: '모델 실측',
  default: '기본값',
  'provider-unsupported': '프로바이더 미지원',
};

const originsWithoutDefaultNote: Set<ParameterOrigin> = new Set<ParameterEntry['origin']>([
  'default',
  'provider-unsupported',
]);

export async function runParamsShow({ container }: CommandContext): Promise<CommandOutcome> {
  const report: ParameterReport = await container.describeParameters();
  const width: number = Math.max(...report.parameters.map((entry) => entry.id.length));
  const lines: string[] = [];

  for (const kind of Object.keys(parameterKindLabels) as ParameterEntry['kind'][]) {
    const entries: ParameterEntry[] = report.parameters.filter((entry) => entry.kind === kind);
    lines.push(`[${parameterKindLabels[kind]}]`);

    for (const entry of entries) {
      const shown: string = String(entry.value).padEnd(12);
      const origin: string = parameterOriginLabels[entry.origin];
      const note: string = originsWithoutDefaultNote.has(entry.origin)
        ? ''
        : `  (기본값 ${String(entry.defaultValue)})`;
      lines.push(`${entry.id.padEnd(width)}  ${shown}  ${origin}${note}`);
    }

    lines.push('');
  }

  lines.push('[적용된 리소스 파일]');
  if (report.resources.applied.length === 0) {
    lines.push('(없음)');
  }
  for (const applied of report.resources.applied) {
    lines.push(`${applied.kind.padEnd(18)}  ${applied.file.fsPath}`);
  }
  for (const problem of report.resources.problems) {
    lines.push(`! ${problem.message}`);
  }

  return { ok: true, message: lines.join('\n'), data: report };
}

function describeOutOfRange(
  definition: StoryboardSettingDefinition,
  value: boolean | number | string,
): string | undefined {
  const { minimum, maximum } = definition;
  const isBelow: boolean = typeof value === 'number' && minimum !== undefined && value < minimum;
  const isAbove: boolean = typeof value === 'number' && maximum !== undefined && value > maximum;

  if (!isBelow && !isAbove) {
    return undefined;
  }

  const range: string = [
    ...(minimum === undefined ? [] : [`${minimum} 이상`]),
    ...(maximum === undefined ? [] : [`${maximum} 이하`]),
  ].join(' ');
  const ending: '이어야' | '여야' = maximum === undefined ? '이어야' : '여야';
  return `${definition.label}(${definition.key}) 값은 ${range}${ending} 합니다: ${value}`;
}

function parseSettingValue(
  kind: StoryboardSettingKind,
  raw: string,
): boolean | number | string | undefined {
  switch (kind) {
    case 'boolean':
      return raw === 'true' ? true : raw === 'false' ? false : undefined;
    case 'integer': {
      const parsed: number = Number.parseInt(raw, 10);
      return Number.isNaN(parsed) ? undefined : parsed;
    }
    case 'decimal': {
      const parsed: number = Number(raw);
      return raw.trim().length === 0 || !Number.isFinite(parsed) ? undefined : parsed;
    }
    case 'string':
      return raw;
  }
}

function describeSaved(
  container: CliContainer,
  key: string,
  value: unknown,
  notes: readonly string[] = [],
): CommandOutcome {
  const file: string = container.configWriteFile;
  const origin: ConfigValueOrigin = container.configBridge.getValueOrigin(key);
  const isShadowed: boolean = file === container.homePaths.configFile && origin === 'workspace';

  return {
    ok: true,
    message: [
      `${key} = ${String(value)} 저장했습니다: ${file}`,
      ...notes,
      ...(isShadowed ? [`다만 이 작품의 ${container.workspaceConfigFile} 값이 우선합니다.`] : []),
    ].join('\n'),
    data: { key, value, origin, file },
  };
}

function describeModelOutsideCatalog(providerId: AiProviderId, model: string): string {
  return (
    `${providerId} 에 없는 모델: ${model}\n` +
    `쓸 수 있는 값: ${storyboardModelCatalog[providerId].map((entry) => entry.id).join(', ')}`
  );
}

function findProviderModelProblem(providerId: AiProviderId, model: string): string | undefined {
  const hasMachineSpecificModelList: boolean = providerId === 'ollama';

  return hasMachineSpecificModelList || isModelInCatalogForProvider(providerId, model)
    ? undefined
    : describeModelOutsideCatalog(providerId, model);
}

async function setProviderField(
  container: CliContainer,
  providerId: AiProviderId,
  field: ProviderKey,
  raw: string,
): Promise<CommandOutcome> {
  const { configBridge } = container;

  if (field === 'model') {
    const modelProblem: string | undefined = findProviderModelProblem(providerId, raw);
    if (modelProblem !== undefined) {
      return { ok: false, message: modelProblem };
    }
    await configBridge.setProviderModel(providerId, raw);
  } else if (field === 'baseUrl') {
    if (providerId !== 'ollama') {
      return { ok: false, message: 'baseUrl 은 ollama 에만 있습니다.' };
    }
    await configBridge.setProviderBaseUrl(raw);
  } else {
    if (providerId !== 'ollama') {
      return { ok: false, message: 'contextTokens 는 ollama 에만 있습니다.' };
    }

    const tokens: number = Number(raw);
    if (!Number.isInteger(tokens) || tokens <= 0) {
      return { ok: false, message: `contextTokens 는 양의 정수여야 합니다: ${raw}` };
    }

    await configBridge.setProviderContextTokens(tokens);
  }

  return describeSaved(container, `providers.${providerId}.${field}`, raw);
}

function describeUnknownKey(key: string): string {
  return (
    `알 수 없는 설정 키: ${key}\n쓸 수 있는 키: ai.provider.default, ` +
    `providers.<id>.${providerKeys.join('|')}, tasks.<task>.provider|model, ` +
    storyboardSettingCatalog.map((entry) => entry.key).join(', ')
  );
}

const taskKeyPattern: RegExp = /^tasks\.([^.]+)\.(provider|model)$/;

function isTaskName(value: string): value is AiTaskName {
  return (aiTaskNames as readonly string[]).includes(value);
}

async function setTaskRoute(
  container: CliContainer,
  taskName: string,
  field: 'provider' | 'model',
  raw: string,
  modelFlag: string | undefined,
): Promise<CommandOutcome> {
  const { configBridge } = container;
  const key: string = `tasks.${taskName}.${field}`;

  if (!isTaskName(taskName)) {
    return {
      ok: false,
      message: `알 수 없는 작업: ${taskName}\n쓸 수 있는 값: ${aiTaskNames.join(', ')}`,
    };
  }

  const current: TaskAiConfigOverride | null = configBridge.getTaskAiConfigOverride(taskName);

  if (field === 'model') {
    if (modelFlag !== undefined) {
      return {
        ok: false,
        message: `--model 은 tasks.${taskName}.provider 와 함께 씁니다. 모델만 바꾸려면 값으로 주세요.`,
      };
    }

    const isFilledFromDefault: boolean = current === null;

    if (isFilledFromDefault && !configBridge.isDefaultProviderConfigured()) {
      return {
        ok: false,
        message:
          `기본 프로바이더가 없어 ${raw} 가 어느 프로바이더의 모델인지 알 수 없습니다.\n` +
          `  storyboard config set tasks.${taskName}.provider <프로바이더> --model ${raw}`,
      };
    }

    const providerId: AiProviderId = current?.providerId ?? configBridge.getDefaultProvider();

    if (!isModelInCatalogForProvider(providerId, raw)) {
      return { ok: false, message: describeModelOutsideCatalog(providerId, raw) };
    }

    await configBridge.setTaskAiConfig(taskName, { providerId, model: raw });
    return describeSaved(
      container,
      key,
      raw,
      isFilledFromDefault
        ? [`프로바이더는 기본값 ${providerId} 로 함께 저장했습니다 (tasks.${taskName}.provider).`]
        : [],
    );
  }

  if (!isProviderId(raw)) {
    return {
      ok: false,
      message: `알 수 없는 프로바이더: ${raw}\n쓸 수 있는 값: ${availableProviderIds().join(', ')}`,
    };
  }

  if (modelFlag !== undefined && !isModelInCatalogForProvider(raw, modelFlag)) {
    return { ok: false, message: describeModelOutsideCatalog(raw, modelFlag) };
  }

  const keptModel: string | null = current?.model ?? null;
  const isKeptModelUsable: boolean =
    keptModel !== null && isModelInCatalogForProvider(raw, keptModel);
  const model: string | null = modelFlag ?? (isKeptModelUsable ? keptModel : null);

  if (modelFlag === undefined && keptModel !== null && !isKeptModelUsable) {
    container.logger.warn(
      `tasks.${taskName}.model 을 비웠습니다: ${keptModel} 는 ${raw} 의 모델이 아닙니다. ` +
        `${raw} 에 정한 모델로 실행합니다.`,
    );
  }

  await configBridge.setTaskAiConfig(taskName, { providerId: raw, model });
  return describeSaved(
    container,
    key,
    raw,
    modelFlag === undefined ? [] : [`tasks.${taskName}.model = ${modelFlag}`],
  );
}

export async function runConfigSet({ container, args }: CommandContext): Promise<CommandOutcome> {
  const { configBridge } = container;
  const key: string | undefined = flagString(args.flags, 'key') ?? args.positionals[0];
  const raw: string | undefined = flagString(args.flags, 'value') ?? args.positionals[1];
  const modelFlag: string | undefined = flagString(args.flags, 'model');

  if (key === undefined || raw === undefined) {
    return { ok: false, message: '사용법: storyboard config set <key> <value>' };
  }

  if (key === 'ai.provider.default') {
    if (!isProviderId(raw)) {
      return {
        ok: false,
        message: `알 수 없는 프로바이더: ${raw}\n쓸 수 있는 값: ${availableProviderIds().join(', ')}`,
      };
    }

    const modelProblem: string | undefined =
      modelFlag === undefined ? undefined : findProviderModelProblem(raw, modelFlag);
    if (modelProblem !== undefined) {
      return { ok: false, message: modelProblem };
    }

    await configBridge.setDefaultProvider(raw);
    if (modelFlag === undefined) {
      return describeSaved(container, key, raw);
    }

    await configBridge.setProviderModel(raw, modelFlag);
    return describeSaved(container, key, raw, [`providers.${raw}.model = ${modelFlag}`]);
  }

  const taskMatch: RegExpExecArray | null = taskKeyPattern.exec(key);

  if (taskMatch) {
    return setTaskRoute(
      container,
      taskMatch[1] ?? '',
      taskMatch[2] as 'provider' | 'model',
      raw,
      modelFlag,
    );
  }

  if (modelFlag !== undefined) {
    return {
      ok: false,
      message: '--model 은 ai.provider.default 나 tasks.<task>.provider 와 함께만 씁니다.',
    };
  }

  const hiddenProviderOutcome: CommandOutcome | undefined = await setHiddenProviderKey(
    container,
    key,
    raw,
  );

  if (hiddenProviderOutcome !== undefined) {
    return hiddenProviderOutcome;
  }

  const providerMatch: RegExpExecArray | null = new RegExp(
    `^providers\\.([a-z-]+)\\.(${providerKeys.join('|')})$`,
  ).exec(key);

  if (providerMatch) {
    const providerId: string = providerMatch[1] ?? '';
    const field: ProviderKey = providerMatch[2] as ProviderKey;

    if (!isProviderId(providerId)) {
      return { ok: false, message: `알 수 없는 프로바이더: ${providerId}` };
    }

    return setProviderField(container, providerId, field, raw);
  }

  const definition: StoryboardSettingDefinition | undefined = storyboardSettingCatalog.find(
    (entry) => entry.key === key,
  );

  if (!definition) {
    return { ok: false, message: describeUnknownKey(key) };
  }

  const value: string | number | boolean | undefined = parseSettingValue(definition.kind, raw);

  if (value === undefined) {
    return { ok: false, message: `${key} 는 ${definition.kind} 값이어야 합니다.` };
  }

  if (definition.kind === 'decimal' && !isOnDecimalStep(value as number)) {
    return {
      ok: false,
      message: `${definition.label}(${key}) 값은 소수 둘째 자리(${decimalSettingStep} 단위)까지만 받습니다: ${raw}`,
    };
  }

  const rangeProblem: string | undefined = describeOutOfRange(definition, value);

  if (rangeProblem !== undefined) {
    return { ok: false, message: rangeProblem };
  }

  try {
    await configBridge.setSettingValue(key, value);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }

  return describeSaved(container, key, value);
}

function findUnsettableKeyProblem(key: string): string | undefined {
  const taskMatch: RegExpExecArray | null = taskKeyPattern.exec(key);

  if (taskMatch) {
    const taskName: string = taskMatch[1] ?? '';
    return isTaskName(taskName)
      ? undefined
      : `알 수 없는 작업: ${taskName}\n쓸 수 있는 값: ${aiTaskNames.join(', ')}`;
  }

  const providerMatch: RegExpExecArray | null = new RegExp(
    `^providers\\.([a-z-]+)\\.(${providerKeys.join('|')})$`,
  ).exec(key);
  const isKnownKey: boolean =
    key === 'ai.provider.default' ||
    (providerMatch !== null && isProviderId(providerMatch[1] ?? '')) ||
    storyboardSettingCatalog.some((entry) => entry.key === key);

  return isKnownKey ? undefined : describeUnknownKey(key);
}

export async function runConfigUnset({ container, args }: CommandContext): Promise<CommandOutcome> {
  const { configBridge } = container;
  const key: string | undefined = flagString(args.flags, 'key') ?? args.positionals[0];

  if (key === undefined) {
    return { ok: false, message: '사용법: storyboard config unset <key>' };
  }

  const keyProblem: string | undefined = findUnsettableKeyProblem(key);

  if (keyProblem !== undefined) {
    return { ok: false, message: keyProblem };
  }

  const taskMatch: RegExpExecArray | null = taskKeyPattern.exec(key);
  const taskName: string | undefined = taskMatch?.[1];
  const isTaskProviderKey: boolean = taskMatch?.[2] === 'provider';

  if (isTaskProviderKey && taskName !== undefined && isTaskName(taskName)) {
    await configBridge.clearTaskAiConfig(taskName);
  } else {
    await configBridge.clearValue(key);
  }

  const file: string = container.configWriteFile;
  const origin: ConfigValueOrigin = configBridge.getValueOrigin(key);
  const value: unknown = configBridge.getConfiguredValue(key);

  return {
    ok: true,
    message: [
      `${key} 를 지웠습니다: ${file}`,
      ...(isTaskProviderKey ? [`tasks.${taskName}.model 도 함께 지웠습니다.`] : []),
      ...(origin === 'default'
        ? []
        : [
            `다만 ${describeOrigin(configBridge, key)} 설정의 값 ${String(value)} 가 계속 적용됩니다.`,
          ]),
    ].join('\n'),
    data: { key, file, origin, value: value ?? null },
  };
}
