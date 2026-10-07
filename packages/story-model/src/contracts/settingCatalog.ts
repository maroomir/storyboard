export type StoryboardSettingKind = 'boolean' | 'integer' | 'decimal' | 'string';

// A `decimal` setting is an amount of money: it moves in cents, so a finer value is refused rather
// than rounded behind the author's back.
export const decimalSettingStep = 0.01;

export interface StoryboardSettingDefinition {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly kind: StoryboardSettingKind;
  readonly defaultValue: boolean | number | string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly group: '생성' | '검수' | '편집기';
}

// The plain on/off and number switches that used to be VSCode settings. Provider, model, and task
// routing have their own UI; everything else the settings panel renders from this list, so adding
// a switch here is what makes it visible to the author.
export const storyboardSettingCatalog: readonly StoryboardSettingDefinition[] = [
  {
    key: 'revise.loop.afterGenerate',
    label: '생성 직후 자동 검수·수정',
    description: '초안을 만든 뒤 검수→수정 루프를 자동으로 이어 돌립니다.',
    kind: 'boolean',
    defaultValue: true,
    group: '검수',
  },
  {
    key: 'revise.loop.maxIterations',
    label: '자동 검수 최대 반복',
    description: '자동 검수·수정 루프를 최대 몇 번까지 돌릴지 정합니다.',
    kind: 'integer',
    defaultValue: 2,
    minimum: 1,
    maximum: 5,
    group: '검수',
  },
  {
    key: 'revise.loop.scoreThreshold',
    label: '검수 통과 점수',
    description: '검수 점수가 이 값 이상이면 수정을 멈춥니다. 0이면 점수를 보지 않습니다.',
    kind: 'integer',
    defaultValue: 0,
    minimum: 0,
    maximum: 100,
    group: '검수',
  },
  {
    key: 'revise.length.maxCompressionPercent',
    label: '압축 허용 한도(%)',
    description: '검수 수정과 압축 명령이 초안을 줄일 수 있는 최대 비율입니다.',
    kind: 'integer',
    defaultValue: 50,
    minimum: 0,
    maximum: 90,
    group: '검수',
  },
  {
    key: 'cards.candidates.updateAfterGenerate',
    label: '생성 후 카드 자동 갱신',
    description: '초안에서 드러난 인물·배경 정보를 카드 후보로 모읍니다.',
    kind: 'boolean',
    defaultValue: false,
    group: '생성',
  },
  {
    key: 'cards.candidates.verify',
    label: '카드 후보 검증',
    description: '모은 카드 후보를 적용하기 전에 AI로 한 번 더 확인합니다.',
    kind: 'boolean',
    defaultValue: true,
    group: '생성',
  },
  {
    key: 'budget.run.limitUsd',
    label: '장편 생성 1회 예산(USD)',
    description:
      '장편 생성을 한 번 실행할 때 쓸 AI 비용의 상한입니다. 넘으면 진행 중인 씬까지 마치고 멈추며, 다시 실행하면 이어서 진행합니다. 0이면 제한하지 않습니다.',
    kind: 'decimal',
    defaultValue: 0,
    minimum: 0,
    maximum: 10000,
    group: '생성',
  },
  {
    key: 'generation.grounding.autoApprove',
    label: '씬 사실 시트 자동 승인',
    description: '생성 직전 AI가 채운 사건·장소·관계·시점을 묻지 않고 받아들입니다.',
    kind: 'boolean',
    defaultValue: false,
    group: '생성',
  },
  {
    key: 'generation.beats.auto',
    label: '씬 비트 자동 전개',
    description: '생성 직전 카드에 beats 가 없으면 사건 비트를 뽑아 카드에 적습니다.',
    kind: 'boolean',
    defaultValue: true,
    group: '생성',
  },
  {
    key: 'generation.beats.charsPerBeat',
    label: '비트당 글자 수',
    description: '목표 분량을 이 값으로 나눠 사건 비트 수를 정합니다.',
    kind: 'integer',
    defaultValue: 1500,
    minimum: 300,
    maximum: 10000,
    group: '생성',
  },
  {
    key: 'generation.section.outputLimit',
    label: '살붙임 구간 상한',
    description:
      '한 번의 살붙임 호출이 낼 수 있는 최대 글자 수입니다. 목표 분량을 이 값으로 나눠 구간 수를 정하므로, 낮추면 호출이 늘고 분량이 늘어납니다.',
    kind: 'integer',
    defaultValue: 7000,
    minimum: 1000,
    maximum: 20000,
    group: '생성',
  },
  {
    key: 'generation.beats.minimum',
    label: '최소 비트 수',
    description: '목표 분량이 작아도 이 개수 이상의 사건 비트를 뽑습니다.',
    kind: 'integer',
    defaultValue: 5,
    minimum: 1,
    maximum: 50,
    group: '생성',
  },
  {
    key: 'editor.draft.keepHistory',
    label: '이전 초안 보관',
    description: '초안을 덮어쓰기 전에 .draft/ 아래에 이전 판을 남깁니다.',
    kind: 'boolean',
    defaultValue: false,
    group: '생성',
  },
  {
    key: 'generation.sceneBreak.enabled',
    label: '장면 전환 구분자 삽입',
    description: '초안 생성 시 장면 사이에 구분자를 넣습니다.',
    kind: 'boolean',
    defaultValue: false,
    group: '생성',
  },
  {
    key: 'generation.sceneBreak.separator',
    label: '장면 전환 구분자',
    description: '--- 같은 구분선이나, 줄바꿈 횟수(1~10)를 숫자로 적습니다.',
    kind: 'string',
    defaultValue: '---',
    group: '생성',
  },
  {
    key: 'generation.context.condense',
    label: '컨텍스트 압축',
    description: '긴 카드·캐넌을 프롬프트에 넣기 전에 요약합니다.',
    kind: 'boolean',
    defaultValue: false,
    group: '생성',
  },
  {
    key: 'editor.scene.prefixDigits',
    label: '씬 번호 자릿수',
    description:
      '새 씬 파일 이름의 번호 자릿수입니다. project.json의 값이 있으면 그쪽이 우선합니다.',
    kind: 'integer',
    defaultValue: 2,
    minimum: 1,
    maximum: 4,
    group: '편집기',
  },
  {
    key: 'editor.studio.validation',
    label: 'Studio 제안 정합성 검사',
    description: 'Studio가 수정을 제안할 때마다 AI로 정합성을 한 번 더 확인합니다.',
    kind: 'boolean',
    defaultValue: true,
    group: '편집기',
  },
  {
    key: 'editor.grammar.realtime',
    label: '문법 실시간 검사',
    description: '초안을 입력하는 동안 문법 검사를 돌립니다. 요청이 많이 발생합니다.',
    kind: 'boolean',
    defaultValue: false,
    group: '편집기',
  },
  {
    key: 'editor.slop.realtime',
    label: '슬롭 저장 시 검사',
    description: '초안을 저장할 때마다 상투적 표현 검사를 돌립니다. AI를 쓰지 않습니다.',
    kind: 'boolean',
    defaultValue: false,
    group: '편집기',
  },
];

export const storyboardSettingKeys = storyboardSettingCatalog.map((entry) => entry.key);

export function findStoryboardSetting(key: string): StoryboardSettingDefinition | undefined {
  return storyboardSettingCatalog.find((entry) => entry.key === key);
}

export function isValidStoryboardSettingValue(
  definition: StoryboardSettingDefinition,
  value: unknown,
): boolean {
  switch (definition.kind) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'integer':
      return (
        typeof value === 'number' && Number.isInteger(value) && isWithinRange(definition, value)
      );
    case 'decimal':
      return (
        typeof value === 'number' && isOnDecimalStep(value) && isWithinRange(definition, value)
      );
    case 'string':
      return typeof value === 'string' && value.trim().length > 0;
  }
}

// A number typed into a settings field. A cleared field reads as no value, never as 0, so the
// caller keeps what is saved.
export function parseSettingNumberInput(text: string): number | undefined {
  const trimmed = text.trim();
  const value = Number(trimmed);

  return trimmed === '' || !Number.isFinite(value) ? undefined : value;
}

export function isOnDecimalStep(value: number): boolean {
  const steps = value / decimalSettingStep;

  return Number.isFinite(steps) && Math.abs(steps - Math.round(steps)) < 1e-9;
}

function isWithinRange(definition: StoryboardSettingDefinition, value: number): boolean {
  return (
    (definition.minimum === undefined || value >= definition.minimum) &&
    (definition.maximum === undefined || value <= definition.maximum)
  );
}

// 기본값과 허용 범위는 이 카탈로그가 갖는다. 설정을 읽는 쪽이 같은 숫자를 다시 적으면 설정 화면과
// 실제 생성이 서로 다른 값을 쓰는 상태로 조용히 갈라진다.
function requireSetting(key: string, kind: StoryboardSettingKind): StoryboardSettingDefinition {
  const definition = findStoryboardSetting(key);

  if (definition === undefined) {
    throw new Error(`알 수 없는 설정 키: ${key}`);
  }

  if (definition.kind !== kind) {
    throw new Error(`설정 ${key} 는 ${definition.kind} 인데 ${kind} 로 읽으려 했습니다.`);
  }

  return definition;
}

export function booleanSettingDefault(key: string): boolean {
  return requireSetting(key, 'boolean').defaultValue as boolean;
}

export function integerSettingDefault(key: string): number {
  return requireSetting(key, 'integer').defaultValue as number;
}

export function decimalSettingDefault(key: string): number {
  return requireSetting(key, 'decimal').defaultValue as number;
}

export function stringSettingDefault(key: string): string {
  return requireSetting(key, 'string').defaultValue as string;
}

export function clampIntegerSetting(key: string, value: number): number {
  return clampToRange(requireSetting(key, 'integer'), value);
}

export function clampDecimalSetting(key: string, value: number): number {
  return clampToRange(requireSetting(key, 'decimal'), value);
}

function clampToRange(definition: StoryboardSettingDefinition, value: number): number {
  const atLeast = definition.minimum === undefined ? value : Math.max(definition.minimum, value);

  return definition.maximum === undefined ? atLeast : Math.min(definition.maximum, atLeast);
}
