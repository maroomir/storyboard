export type StoryboardSettingKind = 'boolean' | 'integer' | 'string';

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
    key: 'draft.reviseAfterGenerate',
    label: '생성 직후 자동 검수·수정',
    description: '초안을 만든 뒤 검수→수정 루프를 자동으로 이어 돌립니다.',
    kind: 'boolean',
    defaultValue: true,
    group: '검수',
  },
  {
    key: 'draft.reviseMaxIterations',
    label: '자동 검수 최대 반복',
    description: '자동 검수·수정 루프를 최대 몇 번까지 돌릴지 정합니다.',
    kind: 'integer',
    defaultValue: 2,
    minimum: 1,
    maximum: 5,
    group: '검수',
  },
  {
    key: 'draft.reviseScoreThreshold',
    label: '검수 통과 점수',
    description: '검수 점수가 이 값 이상이면 수정을 멈춥니다. 0이면 점수를 보지 않습니다.',
    kind: 'integer',
    defaultValue: 0,
    minimum: 0,
    maximum: 100,
    group: '검수',
  },
  {
    key: 'draft.maxCompressionPercent',
    label: '압축 허용 한도(%)',
    description: '검수 수정과 압축 명령이 초안을 줄일 수 있는 최대 비율입니다.',
    kind: 'integer',
    defaultValue: 50,
    minimum: 0,
    maximum: 90,
    group: '검수',
  },
  {
    key: 'draft.updateCardsAfterGenerate',
    label: '생성 후 카드 자동 갱신',
    description: '초안에서 드러난 인물·배경 정보를 카드 후보로 모읍니다.',
    kind: 'boolean',
    defaultValue: false,
    group: '생성',
  },
  {
    key: 'draft.verifyCardCandidates',
    label: '카드 후보 검증',
    description: '모은 카드 후보를 적용하기 전에 AI로 한 번 더 확인합니다.',
    kind: 'boolean',
    defaultValue: true,
    group: '생성',
  },
  {
    key: 'grounding.autoApprove',
    label: '씬 사실 시트 자동 승인',
    description: '생성 직전 AI가 채운 사건·장소·관계·시점을 묻지 않고 받아들입니다.',
    kind: 'boolean',
    defaultValue: false,
    group: '생성',
  },
  {
    key: 'draft.autoBeats',
    label: '씬 비트 자동 전개',
    description: '생성 직전 카드에 beats 가 없으면 사건 비트를 뽑아 카드에 적습니다.',
    kind: 'boolean',
    defaultValue: true,
    group: '생성',
  },
  {
    key: 'draft.charsPerBeat',
    label: '비트당 글자 수',
    description: '목표 분량을 이 값으로 나눠 사건 비트 수를 정합니다.',
    kind: 'integer',
    defaultValue: 1500,
    minimum: 300,
    maximum: 10000,
    group: '생성',
  },
  {
    key: 'draft.minBeats',
    label: '최소 비트 수',
    description: '목표 분량이 작아도 이 개수 이상의 사건 비트를 뽑습니다.',
    kind: 'integer',
    defaultValue: 5,
    minimum: 1,
    maximum: 50,
    group: '생성',
  },
  {
    key: 'draft.keepHistory',
    label: '이전 초안 보관',
    description: '초안을 덮어쓰기 전에 .draft/ 아래에 이전 판을 남깁니다.',
    kind: 'boolean',
    defaultValue: false,
    group: '생성',
  },
  {
    key: 'draft.sceneBreakEnabled',
    label: '장면 전환 구분자 삽입',
    description: '초안 생성 시 장면 사이에 구분자를 넣습니다.',
    kind: 'boolean',
    defaultValue: false,
    group: '생성',
  },
  {
    key: 'draft.sceneBreakSeparator',
    label: '장면 전환 구분자',
    description: '--- 같은 구분선이나, 줄바꿈 횟수(1~10)를 숫자로 적습니다.',
    kind: 'string',
    defaultValue: '---',
    group: '생성',
  },
  {
    key: 'ai.contextCondenseEnabled',
    label: '컨텍스트 압축',
    description: '긴 카드·캐넌을 프롬프트에 넣기 전에 요약합니다.',
    kind: 'boolean',
    defaultValue: false,
    group: '생성',
  },
  {
    key: 'scene.prefixDigits',
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
    key: 'studio.validation',
    label: 'Studio 제안 정합성 검사',
    description: 'Studio가 수정을 제안할 때마다 AI로 정합성을 한 번 더 확인합니다.',
    kind: 'boolean',
    defaultValue: true,
    group: '편집기',
  },
  {
    key: 'grammar.realtimeEnabled',
    label: '문법 실시간 검사',
    description: '초안을 입력하는 동안 문법 검사를 돌립니다. 요청이 많이 발생합니다.',
    kind: 'boolean',
    defaultValue: false,
    group: '편집기',
  },
  {
    key: 'slop.realtimeEnabled',
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
        typeof value === 'number' &&
        Number.isInteger(value) &&
        (definition.minimum === undefined || value >= definition.minimum) &&
        (definition.maximum === undefined || value <= definition.maximum)
      );
    case 'string':
      return typeof value === 'string' && value.trim().length > 0;
  }
}
