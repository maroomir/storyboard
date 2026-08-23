export const storyboardProjectVersion = '1.0.0';

export const projectFormats = ['novel', 'screenplay', 'play', 'essay', 'poem'] as const;

export type ProjectFormat = (typeof projectFormats)[number];

export const pointOfViews = ['first', 'third-limited', 'third-omniscient'] as const;

export type PointOfView = (typeof pointOfViews)[number];

export const contractFieldKeys = ['genre', 'audience', 'pov', 'targetWordCount'] as const;

export type ContractFieldKey = (typeof contractFieldKeys)[number];

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
    sceneLengthMultiplier:
      override.sceneLengthMultiplier ?? defaultCraftContract.sceneLengthMultiplier,
  };
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
