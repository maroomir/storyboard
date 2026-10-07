import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

import {
  aiTaskNames,
  listSelectableProviderIds,
  isHiddenProvider,
  isModelInCatalogForProvider,
  requiresApiKey,
  storyboardModelCatalog,
  storyboardSettingCatalog,
  type AiProviderId,
  type AiTaskName,
  formatSceneOrderRanges,
  findUnreadableStoryStateLines,
  mainThreadId,
  parseSceneFileName,
  parseSceneRenameJournal,
  parseSceneStem,
  readMissingGitignoreEntries,
  type SceneCard,
  type StoryboardProject,
  type StoryboardSettingDefinition,
  type StoryboardSettingKind,
  decimalSettingStep,
  getStoryboardProjectPaths,
  isOnDecimalStep,
  resolveThreadPaths,
} from '@storyboard/story-model';
import { type ConfigBridge } from '@storyboard/story-ai';
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
import type { ParameterEntry } from '@storyboard/story-app';
import type { CommandContext, CommandOutcome } from './outcome';
import { collectHiddenProviderChecks, setHiddenProviderKey } from './hiddenProvider';
import { askLine, askSecret } from './prompt';
import { readSceneCards } from './sceneCards';
import { displayedProviderKeys, settableProviderKeys, type SettableProviderKey } from './catalog';
import { availableProviderIds, enabledHiddenProviderIds } from '@/adapters/availableProviders';

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
  const selectableProviderIds = listSelectableProviderIds(current, enabledHiddenProviderIds());

  process.stderr.write('Storyboard 가 기본으로 쓸 AI 프로바이더를 고르세요.\n');
  selectableProviderIds.forEach((providerId, index) => {
    const marker = providerId === current ? ' (현재)' : '';
    process.stderr.write(
      `  ${index + 1}. ${providerId.padEnd(12)} ${describeProvider(providerId)}${marker}\n`,
    );
  });

  const answer = await askLine('번호 또는 이름 (엔터로 취소): ');

  if (answer.length === 0) {
    return undefined;
  }

  const byIndex = selectableProviderIds[Number(answer) - 1];

  if (byIndex !== undefined) {
    return byIndex;
  }

  return selectableProviderIds.find((providerId) => providerId === answer);
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
    // NOTE: API 키는 --global 여부와 상관없이 0600 홈 파일 하나에만 산다. 설정 파일만 갈린다.
    message:
      `기본 프로바이더를 ${providerId} 로 저장했습니다: ${container.configWriteFile}` +
      (keyStored ? `\nAPI 키를 저장했습니다: ${home.secretsFile}` : ''),
    data: {
      providerId,
      model: configBridge.getProviderConfig(providerId).model,
      keyStored,
      file: container.configWriteFile,
    },
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
  // 서술자·줄기 검사도 같은 카드를 본다. 한 번 읽어 두 진단이 나눠 쓴다.
  readonly cards: readonly { readonly fileName: string; readonly card: SceneCard }[];
  readonly largestSceneTarget: number;
}

// 3,000자에서는 sonnet 도 85%를 냈고 15,000자에서 51%로 떨어졌다. 그 사이 어딘가가 경계이므로
// 두 실측점 중간을 기준으로 삼는다.
const largeSceneTarget = 8_000;
const acceptableReach = 0.8;

// NOTE: 모델이 목표를 못 채우면 사용자는 원인을 파이프라인에서 찾는다. 생성 수십 분을 쓰기 전에
// 목표와 모델의 조합부터 알려 준다.
function collectSceneLengthReachChecks(
  container: CliContainer,
  largestSceneTarget: number,
): DoctorCheck[] {
  const { configBridge } = container;

  if (largestSceneTarget < largeSceneTarget || !configBridge.isDefaultProviderConfigured()) {
    return [];
  }

  const providerId = configBridge.getDefaultProvider();
  const model = configBridge.getProviderConfig(providerId).model;
  // 실측표는 모델 프로필 하나에 모여 있다. 재보지 않은 조합은 프로필이 없고, 그러면 말하지 않는다.
  const measured = configBridge.getModelProfile()?.measured;

  if (measured === undefined || measured.reach >= acceptableReach) {
    return [];
  }

  const reach = measured.reach;

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
  const paths = getStoryboardProjectPaths(container.workspaceRoot);
  const { cards, unreadable } = await readSceneCards(
    container,
    paths.sceneDirectory,
    sceneFileNames,
  );
  const withoutBeats = cards.filter(({ card }) => (card.beats?.length ?? 0) === 0).length;
  const largestSceneTarget = cards.reduce(
    (largest, { card }) => Math.max(largest, card.targetWordCount ?? 0),
    0,
  );

  return { withoutBeats, unreadable, cards, largestSceneTarget };
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

// 장별 요약(.storyboard/memory/summaries.md)이 지금의 초안과 어긋나는지 본다. 어긋난 채로 두면
// 폐기된 판본의 줄거리가 다음 씬 프롬프트로 들어간다.
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

// NOTE: scene rename records itself in a journal, writes every new file, deletes the old ones and
// then the journal. A journal whose old card is still there is a rename cut off before the old card
// went, and the same rename finishes it; cut off after, the old stem's draft or summary is left
// with no card.
function collectInterruptedRenameChecks(
  paths: ReturnType<typeof getStoryboardProjectPaths>,
  sceneFileNames: readonly string[],
  draftFileNames: readonly string[],
): DoctorCheck[] {
  const cardStems = new Set(
    sceneFileNames.flatMap((fileName) => parseSceneFileName(fileName)?.stem ?? []),
  );
  const journal = existsSync(paths.sceneRenameJournal.fsPath)
    ? parseSceneRenameJournal(readFileSync(paths.sceneRenameJournal.fsPath, 'utf8'))
    : undefined;
  const cutOffRename =
    journal !== undefined && cardStems.has(journal.from.stem) ? journal : undefined;

  const orphanFiles = [
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
  const drafts = (
    await container.fileSystem.listFileNames(paths.draftDirectory).catch(() => [])
  ).filter((name) => name.endsWith('.md'));
  const missingDirectories = [paths.sceneDirectory, paths.draftDirectory]
    .filter((uri) => !existsSync(uri.fsPath))
    .map((uri) => `${basename(uri.fsPath)}/`);
  const hasOutline = existsSync(paths.outlineChapters.fsPath);
  const {
    withoutBeats,
    unreadable,
    cards: sceneCards,
    largestSceneTarget,
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
  ];
}

// The author's resource files (prompts, the craft contract, the pipeline specs, …) are read at every
// workspace run; a file that cannot be used is reported here with the reason, so a typo in a
// pipeline spec is caught before a paid run rather than by it.
async function collectResourceChecks(container: CliContainer): Promise<DoctorCheck[]> {
  const report = await container.loadResourceOverrides();

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
  const home = container.homePaths;
  const hasUserConfig = existsSync(home.configFile);
  const workspaceConfig = container.workspaceConfigFile;
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
  // The flat list keeps the order `--json` readers have always had.
  const checks: DoctorCheck[] = [
    ...homeChecks,
    ...sections.slice(1).flatMap((section) => section.checks),
    nodeCheck,
  ];

  const isDrawn = stdout?.isTty === true;

  return {
    ok: !checks.some((check) => check.status === 'fail'),
    message: isDrawn
      ? renderDoctorPanels(sections, stdout).join('\n')
      : checks.map(renderDoctorLine).join('\n'),
    data: { checks },
    isDrawn,
  };
}

function renderDoctorLine(check: DoctorCheck): string {
  const fix = check.fix ? `\n     → ${check.fix}` : '';
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

// Wide enough for a workspace path, narrow enough to read as a panel rather than a log.
const doctorPanelWidth = 100;

// One box per section, a count line, and the first fix to try — what a person at a terminal needs
// to act on without reading every line.
function renderDoctorPanels(sections: readonly DoctorSection[], stream: TerminalStream): string[] {
  const { paint } = stream.theme;
  const visibleSections = sections.filter((section) => section.checks.length > 0);
  const allChecks = visibleSections.flatMap((section) => section.checks);
  const innerWidth = Math.min(stream.columns, doctorPanelWidth) - 4;
  const labelWidth = Math.max(...allChecks.map((check) => measureWidth(check.label))) + 2;

  const describeCheck = (check: DoctorCheck): ColumnRow => {
    const [mark, role] = doctorMarks[check.status];
    const fix = check.fix === undefined ? '' : `\n${paint('muted', `→ ${check.fix}`)}`;
    return { label: `${paint(role, mark)} ${check.label}`, description: `${check.detail}${fix}` };
  };

  const panels = visibleSections.flatMap((section) =>
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
  const summary = [
    paint('success', `통과 ${count('ok')}`),
    paint('warning', `경고 ${count('warn')}`),
    paint('danger', `실패 ${count('fail')}`),
  ].join(paint('muted', ' · '));
  const firstFix =
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
      // 실측으로 정한 모델 기본값과 코드 기본값은 사용자에게 다른 것이다 — 전자는 모델을 바꾸면
      // 따라 바뀐다.
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
    const runtime = configBridge.getProviderConfig(providerId);
    for (const key of displayedProviderKeys) {
      const value = runtime[key];
      if (value !== undefined) {
        const settingKey = `providers.${providerId}.${key}`;
        rows.push({ key: settingKey, value, origin: describeOrigin(configBridge, settingKey) });
      }
    }
  }

  // 라우팅이 없는 작업은 기본 프로바이더를 따른다. 작업이 서른 개가 넘어 정한 것만 보인다.
  for (const taskName of aiTaskNames) {
    const route = configBridge.getTaskAiConfigOverride(taskName);
    if (route === null) {
      continue;
    }

    const routeValues = { provider: route.providerId, model: route.model };
    for (const [field, value] of Object.entries(routeValues)) {
      if (value !== null) {
        const settingKey = `tasks.${taskName}.${field}`;
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
};

// 작가가 움직일 수 있는 값 전부를 한 목록으로: 어떤 값이 지금 어디서 오는지 한눈에 보인다.
export async function runParamsShow({ container }: CommandContext): Promise<CommandOutcome> {
  const report = await container.describeParameters();
  const width = Math.max(...report.parameters.map((entry) => entry.id.length));
  const lines: string[] = [];

  for (const kind of Object.keys(parameterKindLabels) as ParameterEntry['kind'][]) {
    const entries = report.parameters.filter((entry) => entry.kind === kind);
    lines.push(`[${parameterKindLabels[kind]}]`);

    for (const entry of entries) {
      const shown = String(entry.value).padEnd(12);
      const origin = parameterOriginLabels[entry.origin];
      const note = entry.origin === 'default' ? '' : `  (기본값 ${String(entry.defaultValue)})`;
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

// The catalog's bounds, so the author learns what would be accepted instead of only being refused.
function describeOutOfRange(
  definition: StoryboardSettingDefinition,
  value: boolean | number | string,
): string | undefined {
  const { minimum, maximum } = definition;
  const isBelow = typeof value === 'number' && minimum !== undefined && value < minimum;
  const isAbove = typeof value === 'number' && maximum !== undefined && value > maximum;

  if (!isBelow && !isAbove) {
    return undefined;
  }

  const range = [
    ...(minimum === undefined ? [] : [`${minimum} 이상`]),
    ...(maximum === undefined ? [] : [`${maximum} 이하`]),
  ].join(' ');
  const ending = maximum === undefined ? '이어야' : '여야';
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
      const parsed = Number.parseInt(raw, 10);
      return Number.isNaN(parsed) ? undefined : parsed;
    }
    case 'decimal': {
      const parsed = Number(raw);
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
  const file = container.configWriteFile;
  const origin = container.configBridge.getValueOrigin(key);
  // NOTE: 작품 파일이 공통을 덮는다. --global 로 썼는데 이 작품에 같은 키가 있으면 방금 쓴 값은
  // 여기서 가려지므로, 조용히 넘어가면 "고쳤는데 안 바뀐다"가 된다.
  const isShadowed = file === container.homePaths.configFile && origin === 'workspace';

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

// NOTE: 로컬 런타임은 기계마다 받아 둔 모델이 다르다. 카탈로그를 고정 목록으로 강제하면
// 사용자가 이미 가진 모델을 쓸 수 없으므로, ollama 에서는 목록을 제안으로만 쓴다.
function findProviderModelProblem(providerId: AiProviderId, model: string): string | undefined {
  return providerId === 'ollama' || isModelInCatalogForProvider(providerId, model)
    ? undefined
    : describeModelOutsideCatalog(providerId, model);
}

async function setProviderField(
  container: CliContainer,
  providerId: AiProviderId,
  field: SettableProviderKey,
  raw: string,
): Promise<CommandOutcome> {
  const { configBridge } = container;

  if (field === 'model') {
    const modelProblem = findProviderModelProblem(providerId, raw);
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

    const tokens = Number(raw);
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
    `providers.<id>.${settableProviderKeys.join('|')}, tasks.<task>.provider|model, ` +
    storyboardSettingCatalog.map((entry) => entry.key).join(', ')
  );
}

const taskKeyPattern = /^tasks\.([^.]+)\.(provider|model)$/;

function isTaskName(value: string): value is AiTaskName {
  return (aiTaskNames as readonly string[]).includes(value);
}

// A task route is a provider and, optionally, its model: the engine ignores a model with no
// provider, so whichever half is set, the pair is written whole and stays one the engine reads.
async function setTaskRoute(
  container: CliContainer,
  taskName: string,
  field: 'provider' | 'model',
  raw: string,
  modelFlag: string | undefined,
): Promise<CommandOutcome> {
  const { configBridge } = container;
  const key = `tasks.${taskName}.${field}`;

  if (!isTaskName(taskName)) {
    return {
      ok: false,
      message: `알 수 없는 작업: ${taskName}\n쓸 수 있는 값: ${aiTaskNames.join(', ')}`,
    };
  }

  const current = configBridge.getTaskAiConfigOverride(taskName);

  if (field === 'model') {
    if (modelFlag !== undefined) {
      return {
        ok: false,
        message: `--model 은 tasks.${taskName}.provider 와 함께 씁니다. 모델만 바꾸려면 값으로 주세요.`,
      };
    }

    const isFilledFromDefault = current === null;

    if (isFilledFromDefault && !configBridge.isDefaultProviderConfigured()) {
      return {
        ok: false,
        message:
          `기본 프로바이더가 없어 ${raw} 가 어느 프로바이더의 모델인지 알 수 없습니다.\n` +
          `  storyboard config set tasks.${taskName}.provider <프로바이더> --model ${raw}`,
      };
    }

    const providerId = current?.providerId ?? configBridge.getDefaultProvider();

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

  const keptModel = current?.model ?? null;
  const isKeptModelUsable = keptModel !== null && isModelInCatalogForProvider(raw, keptModel);
  const model = modelFlag ?? (isKeptModelUsable ? keptModel : null);

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

// `config set` is the agent-friendly face of the settings panel: one key, one value, validated by
// the same catalog the panel renders.
export async function runConfigSet({ container, args }: CommandContext): Promise<CommandOutcome> {
  const { configBridge } = container;
  const key = flagString(args.flags, 'key') ?? args.positionals[0];
  const raw = flagString(args.flags, 'value') ?? args.positionals[1];
  const modelFlag = flagString(args.flags, 'model');

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

    const modelProblem =
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

  const taskMatch = taskKeyPattern.exec(key);

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

  const hiddenProviderOutcome = await setHiddenProviderKey(container, key, raw);

  if (hiddenProviderOutcome !== undefined) {
    return hiddenProviderOutcome;
  }

  const providerMatch = new RegExp(
    `^providers\\.([a-z-]+)\\.(${settableProviderKeys.join('|')})$`,
  ).exec(key);

  if (providerMatch) {
    const providerId = providerMatch[1] ?? '';
    const field = providerMatch[2] as SettableProviderKey;

    if (!isProviderId(providerId)) {
      return { ok: false, message: `알 수 없는 프로바이더: ${providerId}` };
    }

    return setProviderField(container, providerId, field, raw);
  }

  const definition = storyboardSettingCatalog.find((entry) => entry.key === key);

  if (!definition) {
    return { ok: false, message: describeUnknownKey(key) };
  }

  const value = parseSettingValue(definition.kind, raw);

  if (value === undefined) {
    return { ok: false, message: `${key} 는 ${definition.kind} 값이어야 합니다.` };
  }

  if (definition.kind === 'decimal' && !isOnDecimalStep(value as number)) {
    return {
      ok: false,
      message: `${definition.label}(${key}) 값은 소수 둘째 자리(${decimalSettingStep} 단위)까지만 받습니다: ${raw}`,
    };
  }

  const rangeProblem = describeOutOfRange(definition, value);

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

// The keys `config set` writes, minus the hidden providers' own: those are switched off through
// `config set … false`, which also clears the routes that name the provider.
function findUnsettableKeyProblem(key: string): string | undefined {
  const taskMatch = taskKeyPattern.exec(key);

  if (taskMatch) {
    const taskName = taskMatch[1] ?? '';
    return isTaskName(taskName)
      ? undefined
      : `알 수 없는 작업: ${taskName}\n쓸 수 있는 값: ${aiTaskNames.join(', ')}`;
  }

  const providerMatch = new RegExp(
    `^providers\\.([a-z-]+)\\.(${settableProviderKeys.join('|')})$`,
  ).exec(key);
  const isKnownKey =
    key === 'ai.provider.default' ||
    (providerMatch !== null && isProviderId(providerMatch[1] ?? '')) ||
    storyboardSettingCatalog.some((entry) => entry.key === key);

  return isKnownKey ? undefined : describeUnknownKey(key);
}

// Like `config set`, it touches only the file this run writes to, so a value the other file holds
// comes back into force — said out loud, or the author would think the key is gone everywhere.
export async function runConfigUnset({ container, args }: CommandContext): Promise<CommandOutcome> {
  const { configBridge } = container;
  const key = flagString(args.flags, 'key') ?? args.positionals[0];

  if (key === undefined) {
    return { ok: false, message: '사용법: storyboard config unset <key>' };
  }

  const keyProblem = findUnsettableKeyProblem(key);

  if (keyProblem !== undefined) {
    return { ok: false, message: keyProblem };
  }

  const taskMatch = taskKeyPattern.exec(key);
  const taskName = taskMatch?.[1];
  const isTaskProviderKey = taskMatch?.[2] === 'provider' && taskName !== undefined;

  if (isTaskProviderKey && isTaskName(taskName)) {
    await configBridge.clearTaskAiConfig(taskName);
  } else {
    await configBridge.clearValue(key);
  }

  const file = container.configWriteFile;
  const origin = configBridge.getValueOrigin(key);
  const value = configBridge.getConfiguredValue(key);

  return {
    ok: true,
    message: [
      `${key} 를 지웠습니다: ${file}`,
      ...(isTaskProviderKey ? [`tasks.${taskName}.model 도 함께 지웠습니다.`] : []),
      ...(origin === 'default'
        ? []
        : [`다만 ${describeOrigin(configBridge, key)} 설정의 값 ${String(value)} 가 계속 적용됩니다.`]),
    ].join('\n'),
    data: { key, file, origin, value: value ?? null },
  };
}
