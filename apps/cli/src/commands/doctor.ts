import { isGitRepository } from '@/adapters/gitRepository';
import { collectHiddenProviderChecks, type DoctorCheck } from '@/commands/hiddenProvider';
import { readSceneCards } from '@/commands/sceneCards';
import type { CliContainer } from '@/container';
import type { ProviderModelConfig } from '@storyboard/story-ai';
import type { CardReading, ResourceOverrideReport } from '@storyboard/story-app';
import {
  ChapterMemoryAuditor,
  StoryMemoryAuditor,
  NarratorCardRepository,
  ProjectRepository,
} from '@storyboard/story-engine';
import {
  backgroundCardRelativePath,
  findUnknownBeatCast,
  findUnreadableStoryStateLines,
  flattenChapterPlan,
  formatBackgroundFactConflict,
  formatSceneOrderRanges,
  getStoryboardProjectPaths,
  isHiddenProvider,
  mainThreadId,
  parseSceneFileName,
  parseSceneRenameJournal,
  parseSceneStem,
  readChapterPlanFile,
  readMissingGitignoreEntries,
  requiresApiKey,
  resolveThreadPaths,
  type AiProviderId,
  type ModelMeasurement,
  type NarratorCard,
  type SceneCard,
  type SceneRename,
  type SidebarCardSummary,
  type StoryboardProject,
  type StoryboardProjectPaths,
  type StoryUri,
} from '@storyboard/story-model';
import { existsSync, readFileSync } from 'fs';
import { basename } from 'path';
import type { BackgroundFactConflictReport } from '../../../../packages/story-app/src/managers/cardManager';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { StoryboardHomePaths } from '@storyboard/story-config';
import type { ThemeRole } from '@/terminal/theme';
import type { TerminalStream } from '@/terminal/profile';
import { measureWidth } from '@/terminal/width';
import { renderBox, renderColumns, type ColumnRow } from '@/terminal/layout';

export function statusIcon(status: DoctorCheck['status']): string {
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

export async function collectProviderChecks(container: CliContainer): Promise<DoctorCheck[]> {
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

export interface SceneCardCensus {
  readonly withoutBeats: number;
  readonly unreadable: readonly string[];
  readonly cards: readonly { readonly fileName: string; readonly card: SceneCard }[];
  readonly largestSceneTarget: number;
}

export const largeSceneTarget: number = 8_000;

export const acceptableReach: number = 0.8;

export function collectSceneLengthReachChecks(
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

export async function surveySceneCards(
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

export async function collectNarrationChecks(
  container: CliContainer,
  sceneCards: readonly { readonly fileName: string; readonly card: SceneCard }[],
): Promise<DoctorCheck[]> {
  const paths: StoryboardProjectPaths = getStoryboardProjectPaths(container.workspaceRoot);
  const narrators: ReadonlyMap<string, NarratorCard> = await new NarratorCardRepository(
    container.fileSystem,
  ).list(container.workspaceRoot);
  const project: StoryboardProject | undefined = await new ProjectRepository(container.fileSystem)
    .read(paths.projectJson)
    .catch(() => undefined);
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

export async function findNarrationlessScenes(
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

export async function findUnreadableLedgerLines(
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

export async function collectStoryStateChecks(
  container: CliContainer,
  paths: ReturnType<typeof getStoryboardProjectPaths>,
): Promise<DoctorCheck[]> {
  if (!existsSync(paths.storyState.fsPath)) {
    return [];
  }

  const project: StoryboardProject | undefined = await new ProjectRepository(container.fileSystem)
    .read(paths.projectJson)
    .catch(() => undefined);

  if (project === undefined) {
    return [];
  }

  const { audit } = await new StoryMemoryAuditor({
    fileSystem: container.fileSystem,
    paths,
    format: project.format,
    sceneBreakJoiner: container.configBridge.getDraftSceneBreakSeparator(),
  }).audit();

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

export async function collectChapterSummaryChecks(
  container: CliContainer,
  paths: ReturnType<typeof getStoryboardProjectPaths>,
): Promise<DoctorCheck[]> {
  if (!existsSync(paths.chapterSummaries.fsPath)) {
    return [];
  }

  const { audit } = await new ChapterMemoryAuditor({
    fileSystem: container.fileSystem,
    paths,
  }).audit();

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

export function collectInterruptedRenameChecks(
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

export async function collectWorkspaceChecks(container: CliContainer): Promise<DoctorCheck[]> {
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

export async function collectBeatCastChecks(
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

export async function collectCachedBackgroundConflictChecks(
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

export async function collectResourceChecks(container: CliContainer): Promise<DoctorCheck[]> {
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

export interface DoctorSection {
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

export function renderDoctorLine(check: DoctorCheck): string {
  const fix: string = check.fix ? `\n     → ${check.fix}` : '';
  return `${statusIcon(check.status)} ${check.label}: ${check.detail}${fix}`;
}

export const doctorMarks: Readonly<
  Record<DoctorCheck['status'], readonly [mark: string, role: ThemeRole]>
> = {
  ok: ['✓', 'success'],
  warn: ['▲', 'warning'],
  fail: ['✗', 'danger'],
  info: ['·', 'muted'],
};

export const doctorPanelWidth: number = 100;

export function renderDoctorPanels(
  sections: readonly DoctorSection[],
  stream: TerminalStream,
): string[] {
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
