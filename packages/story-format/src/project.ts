export const storyboardProjectVersion = '1.0.0';

export const projectFormats = ['novel', 'screenplay', 'play', 'essay', 'poem'] as const;

export type ProjectFormat = (typeof projectFormats)[number];

// NOTE: 창작자가 고르는 시점 목록. 서술자 카드를 만들지 않아도 이 값 하나로 서술 인칭·지식 경계가
// 정해진다(암묵 서술자). 값 추가는 하위 호환이다 — 기존 세 값의 의미는 그대로다.
export const pointOfViews = [
  'first',
  'first-retrospective',
  'second',
  'third-limited',
  'third-omniscient',
] as const;

export type PointOfView = (typeof pointOfViews)[number];

// 이름이 쓰이는 자리가 둘이라 칸도 둘이다. `label` 은 아웃라인 본문처럼 «시점: » 뒤에 붙는 짧은
// 이름이고, `optionLabel` 은 고르는 자리에서 혼자 서는 이름이다.
export interface NarrativeChoiceLabels {
  readonly label: string;
  readonly optionLabel: string;
}

export const pointOfViewCatalog: Record<PointOfView, NarrativeChoiceLabels> = {
  first: { label: '1인칭', optionLabel: '1인칭' },
  'first-retrospective': {
    label: '1인칭 회고',
    optionLabel: '1인칭 회고 (결말을 아는 화자)',
  },
  second: { label: '2인칭', optionLabel: '2인칭' },
  'third-limited': { label: '3인칭 제한적', optionLabel: '3인칭 제한적 시점' },
  'third-omniscient': { label: '3인칭 전지적', optionLabel: '3인칭 전지적 시점' },
};

export const pointOfViewLabels: Record<PointOfView, string> = Object.fromEntries(
  pointOfViews.map((pov) => [pov, pointOfViewCatalog[pov].label]),
) as Record<PointOfView, string>;

export const contractFieldKeys = ['genre', 'audience', 'pov', 'targetWordCount'] as const;

export type ContractFieldKey = (typeof contractFieldKeys)[number];

export const contractFieldLabels: Record<ContractFieldKey, string> = {
  genre: '장르',
  audience: '독자층',
  pov: '시점',
  targetWordCount: '목표 분량',
};

export interface ProjectEditor {
  readonly scenePrefixDigits: number;
  readonly trackDraft?: boolean;
}

// 생성 프롬프트에 항상 주입되는 작법 규칙. 프로젝트가 아무 설정도 하지 않아도 기본 계약이 걸린다.
export interface CraftContract {
  readonly banTelling: boolean;
  readonly motifRepeatLimit: number;
  readonly stockGestureBlacklist: readonly string[];
  readonly requireCharacterInterior: boolean;
  readonly actionClarity: boolean;
  readonly modulateDensity: boolean;
  // 목표 분량이 없는 씬의 기본 예산을 씬 시드 길이의 배수로 정한다. 0이면 제한을 걸지 않는다.
  readonly sceneLengthMultiplier: number;
}

export type CraftContractOverride = Partial<CraftContract>;

export const defaultCraftContract: CraftContract = {
  banTelling: true,
  motifRepeatLimit: 3,
  stockGestureBlacklist: [
    '어깨가 떨렸다',
    '눈물이 뺨을 타고 흘렀다',
    '이를 악물었다',
    '눈썹이 떨렸다',
    '입술을 깨물었다',
    '심장이 내려앉았다',
  ],
  requireCharacterInterior: true,
  actionClarity: true,
  modulateDensity: true,
  sceneLengthMultiplier: 12,
};

export function resolveCraftContract(override: CraftContractOverride | undefined): CraftContract {
  if (!override) {
    return defaultCraftContract;
  }

  return {
    banTelling: override.banTelling ?? defaultCraftContract.banTelling,
    motifRepeatLimit: override.motifRepeatLimit ?? defaultCraftContract.motifRepeatLimit,
    stockGestureBlacklist:
      override.stockGestureBlacklist ?? defaultCraftContract.stockGestureBlacklist,
    requireCharacterInterior:
      override.requireCharacterInterior ?? defaultCraftContract.requireCharacterInterior,
    actionClarity: override.actionClarity ?? defaultCraftContract.actionClarity,
    modulateDensity: override.modulateDensity ?? defaultCraftContract.modulateDensity,
    sceneLengthMultiplier:
      override.sceneLengthMultiplier ?? defaultCraftContract.sceneLengthMultiplier,
  };
}

// 구성. 스레드와 서술자를 어떻게 배치할지 정하는 프리셋이며, 실제 배치는 프리셋이 threads와
// 아웃라인 지시로 풀어낸다.
export const compositionKinds = ['linear', 'omnibus', 'alternating-pov', 'frame'] as const;

export type CompositionKind = (typeof compositionKinds)[number];

export const compositionCatalog: Record<CompositionKind, NarrativeChoiceLabels> = {
  linear: { label: '선형', optionLabel: '선형 — 한 줄기로 이어지는 이야기' },
  omnibus: { label: '옴니버스', optionLabel: '옴니버스 — 편마다 독립된 사건과 결말' },
  'alternating-pov': { label: '시점 교차', optionLabel: '시점 교차 — 장마다 서술자가 바뀜' },
  frame: { label: '액자식', optionLabel: '액자식 — 외화가 내화를 감쌈' },
};

export const compositionKindLabels: Record<CompositionKind, string> = Object.fromEntries(
  compositionKinds.map((kind) => [kind, compositionCatalog[kind].label]),
) as Record<CompositionKind, string>;

// 연속성 줄기. 이야기 상태·장 요약·직전 씬 맥락은 스레드 안에서만 이어지고, 캐넌만 전역이다.
export interface StoryThread {
  readonly title: string;
  // 액자식에서 이 스레드가 감싸는 내부 스레드. 조립할 때 외화를 앞뒤에 두는 근거가 된다.
  readonly wraps?: readonly string[];
}

export const mainThreadId = 'main';

// 구성 프리셋이 만들 줄기의 이름과 개수. 프리셋·계약 검사·CLI 도움말이 같은 값을 봐야 «편 두 개
// 이상»이라는 경고와 실제로 만들어지는 편 수가 어긋나지 않는다.
export const compositionPresetDefaults = {
  omnibusEpisodeCount: 3,
  minimumOmnibusEpisodes: 2,
  episodeThreadIdPrefix: 'ep',
  episodeTitleSuffix: '편',
  frameThreadId: 'frame',
  frameThreadTitle: '외화',
  innerThreadId: 'inner',
  innerThreadTitle: '내화',
  mainThreadTitle: '본편',
} as const;

export interface ProjectNarration {
  // 이름 붙인 기본 서술자(`narrator/<id>.card`). 없으면 `pov`에서 암묵 서술자를 파생한다.
  readonly defaultNarrator?: string;
}

export interface ProjectSetting {
  readonly genre?: string;
  readonly country?: string;
  readonly concept?: string;
  readonly tags: string[];
  readonly description?: string;
  readonly audience?: string;
  readonly targetWordCount?: number;
  readonly pov?: PointOfView;
  readonly narration?: ProjectNarration;
  readonly composition?: CompositionKind;
  readonly threads?: Readonly<Record<string, StoryThread>>;
  // 아웃라인이 만들 장·씬 개수. 작품마다 한 번 정하는 값이라 계약에 둔다.
  readonly chapterCount?: number;
  readonly scenesPerChapter?: number;
  readonly prohibitions: string[];
  readonly styleConstraints: string[];
  readonly qualityCriteria: string[];
  readonly craftContract?: CraftContractOverride;
}

export interface StoryboardProject {
  readonly version: typeof storyboardProjectVersion;
  readonly id: string;
  readonly name: string;
  readonly format: ProjectFormat;
  readonly language: string;
  readonly createdAt: string;
  readonly editor: ProjectEditor;
  readonly setting?: ProjectSetting;
}
