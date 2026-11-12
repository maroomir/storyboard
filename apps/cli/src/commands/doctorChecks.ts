import type { DoctorCheck } from '@/commands/doctorCheck';
import { HiddenProviderSwitch } from '@/commands/hiddenProviderSwitch';
import { WorkspaceInput } from '@/commands/workspaceInput';
import { isGitRepository } from '@/adapters/gitRepository';
import type { CliContainer } from '@/container';
import type { ProviderModelConfig } from '@storyboard/story-ai';
import type {
  BackgroundFactConflictReport,
  CardReading,
  ResourceOverrideReport,
} from '@storyboard/story-app';
import type {
  BundleWarning,
  SceneRenameJournal,
  WorkspaceBundleAudit,
} from '@storyboard/story-engine';
import {
  backgroundCardRelativePath,
  computeInterviewContractHash,
  formatBackgroundFactConflict,
  formatSceneOrderRanges,
  getStoryboardProjectPaths,
  isHiddenProvider,
  mainThreadId,
  parseSceneFileName,
  parseSceneStem,
  readMissingGitignoreEntries,
  requiresApiKey,
  type AiProviderId,
  type InterviewAxesFile,
  type InterviewCardCoverage,
  type ModelMeasurement,
  type NarratorCard,
  type SceneCard,
  type StoryboardProject,
  type StoryboardProjectPaths,
  type StoryUri,
} from '@storyboard/story-model';
import { existsSync, readFileSync } from 'fs';
import { basename } from 'path';

export interface SceneCardCensus {
  readonly withoutBeats: number;
  readonly unreadable: readonly string[];
  readonly cards: readonly { readonly fileName: string; readonly card: SceneCard }[];
  readonly largestSceneTarget: number;
}

export const largeSceneTarget: number = 8_000;

export const acceptableReach: number = 0.8;

export function collectInterruptedRenameChecks(
  journal: SceneRenameJournal | undefined,
  sceneFileNames: readonly string[],
  draftFileNames: readonly string[],
): DoctorCheck[] {
  const cardStems: Set<string> = new Set(
    sceneFileNames.flatMap((fileName) => parseSceneFileName(fileName)?.stem ?? []),
  );

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
    ...(journal !== undefined
      ? [
          {
            status: 'fail' as const,
            label: '씬 번호 다시 매기기',
            detail: `씬 폴더·초안 이름 바꾸기가 ${journal.steps.length}단계 중 ${journal.completedSteps}단계에서 끊겼습니다.`,
            fix: 'storyboard init --repair',
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

interface NarrationSurvey {
  readonly narrators: ReadonlyMap<string, NarratorCard>;
  readonly missingNarrators: readonly string[];
  readonly unknownThreads: readonly string[];
  readonly focallessNarrators: readonly NarratorCard[];
}

type NarrationCheck = (survey: NarrationSurvey) => DoctorCheck[];

interface WorkspaceSurvey {
  readonly rootPath: string;
  readonly paths: StoryboardProjectPaths;
  readonly sceneFileNames: readonly string[];
  readonly scenes: readonly string[];
  readonly drafts: readonly string[];
  readonly missingDirectories: readonly string[];
  readonly hasOutline: boolean;
  readonly census: SceneCardCensus;
  readonly missingIgnoreEntries: readonly string[];
  readonly unfinishedSceneRenumbering: SceneRenameJournal | undefined;
}

type WorkspaceCheck = (survey: WorkspaceSurvey) => DoctorCheck[];

function findMissingNarrators(
  sceneCards: SceneCardCensus['cards'],
  project: StoryboardProject | undefined,
  narrators: ReadonlyMap<string, NarratorCard>,
): string[] {
  const referencedNarrators: Set<string> = new Set(
    [
      ...sceneCards.map(({ card }) => card.narrator),
      project?.setting?.narration?.defaultNarrator,
    ].filter((id): id is string => id !== undefined),
  );

  return [...referencedNarrators].filter((id) => !narrators.has(id));
}

function findUnknownThreads(
  sceneCards: SceneCardCensus['cards'],
  project: StoryboardProject | undefined,
): string[] {
  const declaredThreads: Set<string> = new Set([
    ...Object.keys(project?.setting?.threads ?? {}),
    mainThreadId,
  ]);

  return [
    ...new Set(
      sceneCards
        .map(({ card }) => card.thread)
        .filter((thread): thread is string => thread !== undefined)
        .filter((thread) => !declaredThreads.has(thread)),
    ),
  ];
}

function findFocallessNarrators(narrators: ReadonlyMap<string, NarratorCard>): NarratorCard[] {
  return [...narrators.values()].filter(
    (narrator) =>
      narrator.focal === undefined && (narrator.person === 'first' || narrator.person === 'second'),
  );
}

function checkNarrators({ narrators }: NarrationSurvey): DoctorCheck[] {
  return narrators.size > 0
    ? [
        {
          status: 'ok',
          label: '서술자',
          detail: `${narrators.size}개 (${[...narrators.keys()].join(', ')})`,
        },
      ]
    : [];
}

function checkMissingNarrators({ missingNarrators }: NarrationSurvey): DoctorCheck[] {
  return missingNarrators.length > 0
    ? [
        {
          status: 'fail',
          label: '서술자 참조',
          detail: `카드가 없는 서술자를 참조합니다 (${missingNarrators.join(', ')}). 그 씬은 생성되지 않습니다.`,
          fix: `storyboard card create narrator ${missingNarrators[0]}`,
        },
      ]
    : [];
}

function checkUnknownThreads({ unknownThreads }: NarrationSurvey): DoctorCheck[] {
  return unknownThreads.length > 0
    ? [
        {
          status: 'warn',
          label: '줄기',
          detail: `작품 계약에 없는 줄기를 씬이 참조합니다 (${unknownThreads.join(', ')}).`,
          fix: 'storyboard project set --composition omnibus --episodes <n>',
        },
      ]
    : [];
}

function checkFocallessNarrators({ focallessNarrators }: NarrationSurvey): DoctorCheck[] {
  return focallessNarrators.length > 0
    ? [
        {
          status: 'warn',
          label: '서술자 초점',
          detail: `초점 인물이 없는 1·2인칭 서술자가 있습니다 (${focallessNarrators.map((narrator) => narrator.id).join(', ')}). 서술자 카드에 초점 인물(--focal)을 정해 주세요.`,
        },
      ]
    : [];
}

const narrationChecks: readonly NarrationCheck[] = [
  checkNarrators,
  checkMissingNarrators,
  checkUnknownThreads,
  checkFocallessNarrators,
];

function checkMissingDirectories({ missingDirectories }: WorkspaceSurvey): DoctorCheck[] {
  return missingDirectories.length > 0
    ? [
        {
          status: 'warn',
          label: '디렉터리',
          detail: `${missingDirectories.join(', ')} 이(가) 없습니다.`,
          fix: 'storyboard init --repair',
        },
      ]
    : [];
}

function checkInterruptedRenames(survey: WorkspaceSurvey): DoctorCheck[] {
  return collectInterruptedRenameChecks(
    survey.unfinishedSceneRenumbering,
    survey.sceneFileNames,
    survey.drafts,
  );
}

function checkUnreadableSceneCards({ census }: WorkspaceSurvey): DoctorCheck[] {
  return census.unreadable.length > 0
    ? [
        {
          status: 'warn',
          label: '씬 카드',
          detail: `읽지 못한 카드가 있습니다 (${census.unreadable.join(', ')}).`,
        },
      ]
    : [];
}

function checkScenesWithoutBeats({ census }: WorkspaceSurvey): DoctorCheck[] {
  return census.withoutBeats > 0
    ? [
        {
          status: 'warn',
          label: '씬 비트',
          detail: `비트 없는 씬이 ${census.withoutBeats}개 있습니다. 생성 시 자동으로 채우지만 미리 검수하려면 뽑아 두세요.`,
          fix: 'storyboard scene plot --all',
        },
      ]
    : [];
}

function checkGitignore({ missingIgnoreEntries }: WorkspaceSurvey): DoctorCheck[] {
  return missingIgnoreEntries.length > 0
    ? [
        {
          status: 'warn',
          label: '.gitignore',
          detail: `생성물 항목이 빠졌습니다 (${missingIgnoreEntries.join(', ')}).`,
          fix: 'storyboard init --repair',
        },
      ]
    : [];
}

function checkGitRepository({ rootPath }: WorkspaceSurvey): DoctorCheck[] {
  return [
    isGitRepository(rootPath)
      ? { status: 'ok', label: 'git', detail: '저장소 있음' }
      : {
          status: 'warn',
          label: 'git',
          detail: '워크스페이스가 git 저장소가 아닙니다.',
          fix: 'storyboard init --repair',
        },
  ];
}

function checkOutline({ hasOutline }: WorkspaceSurvey): DoctorCheck[] {
  return [
    {
      status: hasOutline ? 'ok' : 'info',
      label: '아웃라인',
      detail: hasOutline ? 'chapters.yaml 있음' : '아직 없음',
      ...(hasOutline ? {} : { fix: 'storyboard outline generate' }),
    },
  ];
}

function checkSceneCount({ scenes, drafts }: WorkspaceSurvey): DoctorCheck[] {
  return [
    {
      status: scenes.length > 0 ? 'ok' : 'info',
      label: '씬',
      detail: `${scenes.length}개 (초안 ${drafts.length}개)`,
      ...(scenes.length > 0
        ? {}
        : { fix: 'storyboard scene seed  또는  storyboard scene create "<설명>"' }),
    },
  ];
}

const bundleWarningLabels: Readonly<Record<BundleWarning['kind'], string>> = {
  'copied-id': '복사된 uuid',
  'unknown-entry': '번들의 모르는 파일',
  'changed-outside-engine': '엔진 밖 변경',
  'slug-mismatch': '번들 slug',
  unreadable: '읽지 못한 번들',
};

const sceneBundlePrefix: string = 'scene/';

function describeBundleWarning(warning: BundleWarning): DoctorCheck[] {
  if (warning.kind === 'unreadable') {
    const isSceneBundle: boolean = warning.paths.every((path) => path.startsWith(sceneBundlePrefix));
    return isSceneBundle
      ? []
      : [{ status: 'fail', label: bundleWarningLabels.unreadable, detail: warning.message }];
  }

  const isCopiedId: boolean = warning.kind === 'copied-id';
  return [
    {
      status: isCopiedId ? 'fail' : 'warn',
      label: bundleWarningLabels[warning.kind],
      detail: warning.message,
      ...(isCopiedId ? { fix: 'storyboard init --repair' } : {}),
    },
  ];
}

const workspaceLayoutChecks: readonly WorkspaceCheck[] = [
  checkMissingDirectories,
  checkInterruptedRenames,
  checkUnreadableSceneCards,
  checkScenesWithoutBeats,
];

const workspaceRepositoryChecks: readonly WorkspaceCheck[] = [
  checkGitignore,
  checkGitRepository,
  checkOutline,
  checkSceneCount,
];

export class DoctorChecks {
  public constructor(private readonly container: CliContainer) {}

  public async provider(): Promise<DoctorCheck[]> {
    const { configBridge, secretStore } = this.container;

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
      checks.push(...(await new HiddenProviderSwitch(this.container).checks(providerId)));
    }

    return checks;
  }

  private sceneLengthReach(largestSceneTarget: number): DoctorCheck[] {
    const { configBridge } = this.container;

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

  private async surveySceneCards(): Promise<SceneCardCensus> {
    const { cards, unreadable } = await new WorkspaceInput(this.container).readSceneCards();
    const withoutBeats: number = cards.filter(({ card }) => (card.beats?.length ?? 0) === 0).length;
    const largestSceneTarget: number = cards.reduce(
      (largest, { card }) => Math.max(largest, card.targetWordCount ?? 0),
      0,
    );

    return { withoutBeats, unreadable, cards, largestSceneTarget };
  }

  private async narration(sceneCards: SceneCardCensus['cards']): Promise<DoctorCheck[]> {
    const survey: NarrationSurvey = await this.surveyNarration(sceneCards);

    return narrationChecks.flatMap((check: NarrationCheck): DoctorCheck[] => check(survey));
  }

  private async surveyNarration(sceneCards: SceneCardCensus['cards']): Promise<NarrationSurvey> {
    const narrators: ReadonlyMap<string, NarratorCard> = await this.container.cards.listNarrators(
      this.container.workspaceRoot,
    );
    const project: StoryboardProject | undefined = await this.container.project
      .read(this.container.workspaceRoot)
      .catch(() => undefined);

    return {
      narrators,
      missingNarrators: findMissingNarrators(sceneCards, project, narrators),
      unknownThreads: findUnknownThreads(sceneCards, project),
      focallessNarrators: findFocallessNarrators(narrators),
    };
  }

  private async storyState(): Promise<DoctorCheck[]> {
    const project: StoryboardProject | undefined = await this.container.project
      .read(this.container.workspaceRoot)
      .catch(() => undefined);

    if (project === undefined) {
      return [];
    }

    const { audit } = await this.container.workspace.auditStoryState(this.container.workspaceRoot);

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

  private async chapterSummaries(): Promise<DoctorCheck[]> {
    const { audit } = await this.container.workspace.auditChapterMemory(
      this.container.workspaceRoot,
    );

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

  public async workspace(): Promise<DoctorCheck[]> {
    const root: StoryUri = this.container.workspaceRoot;
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

    const survey: WorkspaceSurvey = await this.surveyWorkspace(root.fsPath, paths);
    const runChecks = (checks: readonly WorkspaceCheck[]): DoctorCheck[] =>
      checks.flatMap((check: WorkspaceCheck): DoctorCheck[] => check(survey));

    return [
      { status: 'ok', label: '워크스페이스', detail: root.fsPath },
      ...runChecks(workspaceLayoutChecks),
      ...this.sceneLengthReach(survey.census.largestSceneTarget),
      ...(await this.storyState()),
      ...(await this.chapterSummaries()),
      ...runChecks(workspaceRepositoryChecks),
      ...(await this.narration(survey.census.cards)),
      ...(await this.bundles()),
      ...(await this.cachedBackgroundConflicts()),
      ...(await this.interviews()),
      ...(await this.addressCatchphrases()),
    ];
  }

  private async surveyWorkspace(
    rootPath: string,
    paths: StoryboardProjectPaths,
  ): Promise<WorkspaceSurvey> {
    const census: SceneCardCensus = await this.surveySceneCards();
    const sceneFileNames: readonly string[] = census.cards.map(({ fileName }) => fileName);
    const scenes: readonly string[] = sceneFileNames;
    const drafts: string[] = (
      await this.container.fileSystem.listFileNames(paths.draftDirectory).catch(() => [])
    ).filter((name) => name.endsWith('.md'));
    const missingDirectories: string[] = [paths.sceneDirectory, paths.draftDirectory]
      .filter((uri) => !existsSync(uri.fsPath))
      .map((uri) => `${basename(uri.fsPath)}/`);
    const hasOutline: boolean = existsSync(paths.outlineChapters.fsPath);
    const missingIgnoreEntries: readonly string[] = readMissingGitignoreEntries(
      existsSync(paths.gitignore.fsPath) ? readFileSync(paths.gitignore.fsPath, 'utf8') : undefined,
    );

    return {
      rootPath,
      paths,
      sceneFileNames,
      scenes,
      drafts,
      missingDirectories,
      hasOutline,
      census,
      missingIgnoreEntries,
      unfinishedSceneRenumbering: await this.container.workspace.findUnfinishedSceneRenumbering(
        this.container.workspaceRoot,
      ),
    };
  }

  private async bundles(): Promise<DoctorCheck[]> {
    const audit: WorkspaceBundleAudit = await this.container.workspace.auditBundles(
      this.container.workspaceRoot,
    );

    return [
      ...audit.warnings.flatMap(describeBundleWarning),
      ...(audit.misnumberedScenes.length === 0
        ? []
        : [
            {
              status: 'warn' as const,
              label: '씬 번호',
              detail: `폴더 번호가 구조 순서와 다릅니다: ${audit.misnumberedScenes.join(', ')}`,
              fix: 'storyboard init --repair',
            },
          ]),
      ...(audit.unusedBackgrounds.length === 0
        ? []
        : [
            {
              status: 'info' as const,
              label: '쓰이지 않는 배경',
              detail: `어느 씬의 장소도 아닌 배경 카드: ${audit.unusedBackgrounds.join(', ')}`,
            },
          ]),
      ...audit.sharedAliases.map((shared) => ({
        status: 'info' as const,
        label: '겹치는 별칭',
        detail: `배경 ${shared.slugs.join(', ')} 가 «${shared.alias}» 를 함께 씁니다. 노트 흡수와 생성이 어느 쪽인지 헷갈릴 수 있습니다.`,
      })),
    ];
  }

  private async addressCatchphrases(): Promise<DoctorCheck[]> {
    const root: StoryUri = this.container.workspaceRoot;
    const readings: CardReading[] = [];
    for (const summary of await this.container.cards.list(root, 'character')) {
      const reading: CardReading | undefined = await this.container.cards.read(root, summary.id);
      if (reading?.card.type === 'character') {
        readings.push(reading);
      }
    }

    const checks: DoctorCheck[] = [];
    for (const { card } of readings) {
      if (card.type !== 'character') {
        continue;
      }
      const speeches: string = (card.relations ?? []).map((relation) => relation.speech ?? '').join(' ');
      for (const catchphrase of card.catchphrases ?? []) {
        const addressed: CardReading | undefined = readings.find(
          (other) =>
            other.card.id !== card.id &&
            [other.card.name, ...(other.card.aliases ?? []), ...(other.card.type === 'location' ? other.card.tags : [])].includes(catchphrase),
        );
        if (addressed !== undefined && !speeches.includes(catchphrase)) {
          checks.push({
            status: 'warn',
            label: '호칭 입버릇',
            detail: `${card.name}의 입버릇 «${catchphrase}»는 ${addressed.card.name}을(를) 가리키는 호칭으로 보이는데, 어느 relations[].speech 에도 없습니다. 뼈대가 다른 상대에게도 쓸 수 있습니다.`,
            fix: `storyboard card interview ${card.id} (첫 질문이 상대별 호칭을 묻습니다) 또는 카드의 relations[].speech 에 «${catchphrase}»를 적으세요`,
          });
        }
      }
    }

    return checks;
  }

  private async interviews(): Promise<DoctorCheck[]> {
    const root: StoryUri = this.container.workspaceRoot;
    const coverage: InterviewCardCoverage[] = await this.container.interviews.describeCoverage({
      workspaceRoot: root,
    });
    const unreadable: DoctorCheck[] = coverage.flatMap((entry) =>
      entry.unreadableWorkingModel === undefined
        ? []
        : [
            {
              status: 'fail' as const,
              label: '인터뷰 작업 모델',
              detail: `${entry.unreadableWorkingModel.relativePath}: ${entry.unreadableWorkingModel.message}`,
              fix: `파일을 고치거나 지우세요. 지우면 ${entry.name} 인터뷰는 처음부터 다시 시작합니다`,
            },
          ],
    );
    const undecided: InterviewCardCoverage[] = coverage.filter(
      (entry) => entry.hasWorkingModel && entry.openAxes.length > 0,
    );
    const checks: DoctorCheck[] = [
      ...unreadable,
      ...undecided.map((entry) => ({
        status: 'info' as const,
        label: '인터뷰',
        detail: `${entry.name}(${entry.cardId}): 다음 씬 ${entry.upcomingSceneStems.join(', ')}에 답이 없는 축 — ${entry.openAxes.map((axis) => axis.axisLabel).join(' · ')}`,
        fix: `storyboard card interview ${entry.cardId}`,
      })),
    ];

    const axes: InterviewAxesFile = await this.container.interviews.readAxes(root);
    if (axes.character === undefined && axes.background === undefined) {
      return checks;
    }

    const project: StoryboardProject = await this.container.project.read(root);
    const contractHash: string = computeInterviewContractHash(project.setting);
    const staleKinds: string[] = (['character', 'background'] as const)
      .filter((kind) => axes[kind] !== undefined && axes[kind]?.contractHash !== contractHash)
      .map((kind) => (kind === 'character' ? '인물' : '배경'));

    return staleKinds.length === 0
      ? checks
      : [
          ...checks,
          {
            status: 'warn',
            label: '인터뷰 축',
            detail: `${staleKinds.join('·')} 축 어휘를 뽑은 뒤 작품 계약(장르·독자층·컨셉)이 바뀌었습니다. 어휘는 그대로 쓰이고 있습니다.`,
            fix: 'storyboard card interview <id> --reset-axes (표와 작업 모델도 비워집니다)',
          },
        ];
  }

  private async cachedBackgroundConflicts(): Promise<DoctorCheck[]> {
    const reports: BackgroundFactConflictReport[] =
      await this.container.cards.listBackgroundFactConflicts(this.container.workspaceRoot);

    return reports.map((report) => ({
      status: 'warn' as const,
      label: '배경 사실 상충',
      detail: `${report.cardId}: ${report.conflicts.map(formatBackgroundFactConflict).join(', ')}는 함께 참일 수 없습니다. 생성은 사건에 맞는 쪽만 씁니다.`,
      fix: `${backgroundCardRelativePath(report.cardId)}에서 하나를 지우거나 고치세요`,
    }));
  }

  public async resources(): Promise<DoctorCheck[]> {
    const report: ResourceOverrideReport = await this.container.loadResourceOverrides();

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
}
