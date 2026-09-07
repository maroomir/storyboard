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

export const compositionKindLabels: Record<CompositionKind, string> = {
  linear: '선형',
  omnibus: '옴니버스',
  'alternating-pov': '시점 교차',
  frame: '액자식',
};

// 연속성 줄기. 이야기 상태·장 요약·직전 씬 맥락은 스레드 안에서만 이어지고, 캐넌만 전역이다.
export interface StoryThread {
  readonly title: string;
  // 액자식에서 이 스레드가 감싸는 내부 스레드. 조립할 때 외화를 앞뒤에 두는 근거가 된다.
  readonly wraps?: readonly string[];
}

export const mainThreadId = 'main';

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
