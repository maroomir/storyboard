import {
  bibleSubjectKinds,
  compositionKinds,
  compositionPresetDefaults,
  narrativeTenses,
  narratorKnowledges,
  narratorPersons,
  pointOfViews,
  type BibleSubjectKind,
} from '@storyboard/story-model';

export type CommandGroup =
  | '시작하기'
  | '기획'
  | '씬'
  | '초안'
  | '카드'
  | '노트'
  | '원고'
  | '측정';

export type GlobalFlagName =
  | 'workspace'
  | 'provider'
  | 'model'
  | 'json'
  | 'quiet'
  | 'verbose'
  | 'no-color'
  | 'help'
  | 'version';

export const globalFlagNames: readonly GlobalFlagName[] = [
  'workspace',
  'provider',
  'model',
  'json',
  'quiet',
  'verbose',
  'no-color',
  'help',
  'version',
];

export const sharedFlagNames: readonly GlobalFlagName[] = ['workspace', 'json', 'quiet', 'verbose'];

export type CompletionShell = 'zsh' | 'bash' | 'fish';

export const completionShells: readonly CompletionShell[] = ['zsh', 'bash', 'fish'];

export type InitLanguage = 'ko' | 'en' | 'ja';

export const initLanguages: readonly InitLanguage[] = ['ko', 'en', 'ja'];

export const cardCategories: readonly BibleSubjectKind[] = bibleSubjectKinds;

export type CardKind = BibleSubjectKind | 'narrator';

export const cardKinds: readonly CardKind[] = [...bibleSubjectKinds, 'narrator'];

export { draftCheckKinds, type DraftCheckKind } from '@storyboard/story-engine';

export type NoteSource = 'notion';

export const noteSources: readonly NoteSource[] = ['notion'];

export const defaultNoteSource: NoteSource = 'notion';

export type ProviderKey = 'model' | 'baseUrl' | 'contextTokens';

export const providerKeys: readonly ProviderKey[] = ['model', 'baseUrl', 'contextTokens'];

export const commandGroups: readonly CommandGroup[] = [
  '시작하기',
  '기획',
  '씬',
  '초안',
  '카드',
  '노트',
  '원고',
  '측정',
];

export const commandGroupIds: Readonly<Record<CommandGroup, string>> = {
  시작하기: 'start',
  기획: 'plan',
  씬: 'scene',
  초안: 'draft',
  카드: 'card',
  노트: 'notes',
  원고: 'manuscript',
  측정: 'sim',
};

export function findCommandGroup(topic: string): CommandGroup | undefined {
  const needle: string = topic.trim().toLowerCase();
  return commandGroups.find((group) => group === needle || commandGroupIds[group] === needle);
}

export interface CommandSpec {
  readonly verb: string;
  readonly group: CommandGroup;
  readonly usage: string;
  readonly summary: string;
  readonly flags?: readonly string[];
  readonly examples?: readonly string[];
  readonly needsWorkspace?: false;
  readonly writesWorkspace?: true;
  readonly readsOnlyWithFlags?: readonly string[];
  readonly rewritesDraft?: true;
}

export interface FlagSpec {
  readonly name: string;
  readonly valueLabel?: string;
  readonly summary: string;
}

export const flagCatalog: readonly FlagSpec[] = [
  { name: 'workspace', valueLabel: '<path>', summary: '대상 워크스페이스 (기본: 현재 디렉터리)' },
  {
    name: 'global',
    summary: '설정을 이 작품이 아니라 모든 작품(~/.storyboard/config.json)에 저장',
  },
  {
    name: 'provider',
    valueLabel: '<id>',
    summary: '이번 실행에만 쓸 프로바이더 (claude, openai, google …)',
  },
  { name: 'model', valueLabel: '<name>', summary: '그 프로바이더의 모델' },
  { name: 'track', valueLabel: '<path>', summary: 'sim: 트랙 저장소 경로' },
  {
    name: 'config',
    valueLabel: '<file>',
    summary: 'sim: 기계 프로필 (기본: <track>/sim.config.json)',
  },
  { name: 'genre', valueLabel: '<name>', summary: 'sim: 연쇄 트랙의 장르 디렉터리' },
  { name: 'overlay', valueLabel: '<file>', summary: 'sim: 손잡이 값을 덮는 JSON 한 장' },
  { name: 'knobs', valueLabel: '<a,b,c>', summary: 'sim: 흔들 손잡이 목록 (쉼표로 구분)' },
  { name: 'repeats', valueLabel: '<n>', summary: 'sim: 같은 지점을 몇 번 돌릴지 (기본 3)' },
  {
    name: 'judge',
    valueLabel: '<provider|none>',
    summary: 'sim: 심판 프로바이더 (생성과 다른 모델이어야 합니다. none 이면 생성만)',
  },
  { name: 'judge-model', valueLabel: '<name>', summary: 'sim: 심판 모델' },
  {
    name: 'prompt-variant',
    valueLabel: '<generic|xs|rich>',
    summary: 'sim: 생성 프롬프트 변형을 강제 (로컬 모델은 기본 xs)',
  },
  { name: 'max-runs', valueLabel: '<n>', summary: 'sim: 실행 횟수 상한' },
  { name: 'out', valueLabel: '<path>', summary: 'sim: 결과를 쌓을 JSONL 경로' },
  { name: 'point', valueLabel: '<label>', summary: 'sim: 되쓰기할 지점의 이름' },
  {
    name: 'profiles',
    valueLabel: '<path>',
    summary: 'sim: 적을 modelProfiles.params.json 경로 (기본: 엔진 저장소의 파일)',
  },
  {
    name: 'source',
    valueLabel: '<engine>',
    summary: 'sim: 다시 채점할 원본 기록의 엔진 커밋 접두어 (기본: 전부)',
  },
  { name: 'yes', summary: '견적·계획을 묻지 않고 바로 진행합니다 (sim, notes absorb)' },
  {
    name: 'from-notes',
    valueLabel: '<path|url>',
    summary:
      'init: 만든 워크스페이스에 노트를 흡수합니다 (Obsidian 폴더·노트, Notion 주소, Notion 내보내기 zip)',
  },
  { name: 'revise-iterations', valueLabel: '<n>', summary: '검수-재작성 반복 상한 (1-5)' },
  { name: 'no-revise', summary: '생성 뒤 검수-재작성을 건너뜁니다' },
  {
    name: 'all',
    summary:
      'draft generate: 초안이 없거나 입력이 바뀐 씬을 모두 / scene plot: 비트 없는 씬을 모두 / help: 전체 명령',
  },
  {
    name: 'force',
    summary:
      '이미 있는 결과를 덮어씁니다 (draft generate, scene plot, scene seed, outline generate) · card remove: 가리키는 곳을 함께 정리하고 지웁니다',
  },
  { name: 'out', valueLabel: '<path>', summary: 'manuscript export 의 출력 파일' },
  { name: 'lines', valueLabel: '<a-b>', summary: '대상 줄 범위 (없으면 본문 전체)' },
  { name: 'instruction', valueLabel: '<text>', summary: 'draft augment/edit 에 줄 지시' },
  { name: 'name', valueLabel: '<text>', summary: 'card create 가 쓸 이름 (없으면 스튜디오가 설명에서 채움), scene create 의 slug' },
  { name: 'id', valueLabel: '<slug>', summary: 'card create 의 slug (기본: 이름에서 유도)' },
  { name: 'to', valueLabel: '<id>', summary: 'card rename 의 새 id, scene rename 의 새 stem' },
  { name: 'after', valueLabel: '<씬>', summary: 'scene create/move: 이 씬 바로 뒤에 둡니다 (번호-slug, 번호, slug)' },
  { name: 'title', valueLabel: '<name>', summary: 'init 이 만들 작품 이름' },
  {
    name: 'repair',
    summary:
      'init: 이미 있는 워크스페이스의 디렉터리·.gitignore·git 저장소만 보수합니다 (계약은 그대로)',
  },
  {
    name: 'language',
    valueLabel: '<code>',
    summary: `init 의 언어 (기본 ${initLanguages[0]})`,
  },
  {
    name: 'from',
    valueLabel: '<path>',
    summary: '작품 계약을 읽어올 JSON (project.json 도 그대로 받습니다)',
  },
  { name: 'genre', valueLabel: '<text>', summary: '작품 계약: 장르' },
  { name: 'audience', valueLabel: '<text>', summary: '작품 계약: 독자층' },
  {
    name: 'pov',
    valueLabel: '<value>',
    summary: `작품 계약: 시점 (${pointOfViews.join(', ')})`,
  },
  {
    name: 'composition',
    valueLabel: '<kind>',
    summary: `작품 계약: 구성 (${compositionKinds.join(', ')})`,
  },
  {
    name: 'episodes',
    valueLabel: '<n>',
    summary: `옴니버스 구성이 만들 편 수 (기본 ${compositionPresetDefaults.omnibusEpisodeCount})`,
  },
  {
    name: 'pov-characters',
    valueLabel: '<ids>',
    summary: '시점 교차가 서술자 카드를 만들 인물 id (쉼표로 구분)',
  },
  {
    name: 'person',
    valueLabel: '<value>',
    summary: `card create narrator: 인칭 (${narratorPersons.join(', ')})`,
  },
  {
    name: 'knowledge',
    valueLabel: '<value>',
    summary: `card create narrator: 지식 경계 (${narratorKnowledges.join(', ')})`,
  },
  {
    name: 'tense',
    valueLabel: '<value>',
    summary: `card create narrator: 시제 (${narrativeTenses.join(', ')})`,
  },
  { name: 'focal', valueLabel: '<id>', summary: 'card create narrator: 초점 인물 카드 slug' },
  { name: 'voice', valueLabel: '<text>', summary: 'card create narrator: 서술자 목소리 (쉼표로 구분)' },
  { name: 'target-words', valueLabel: '<n>', summary: '작품 계약: 목표 분량(자)' },
  { name: 'chapters', valueLabel: '<n>', summary: '작품 계약: 장 수' },
  { name: 'scenes-per-chapter', valueLabel: '<n>', summary: '작품 계약: 장당 씬 수' },
  { name: 'concept', valueLabel: '<text>', summary: '작품 계약: 한 줄 콘셉트' },
  { name: 'description', valueLabel: '<text>', summary: '작품 계약: 설명' },
  { name: 'key', valueLabel: '<key>', summary: 'config set 이 바꿀 설정 키, card set/unset 의 진술 key' },
  { name: 'about', valueLabel: '<slug>', summary: 'card set/unset: 진술이 가리키는 상대 카드' },
  { name: 'sources', summary: 'card show: 진술마다 줄 번호와 출처를 보여 줍니다' },
  { name: 'history', summary: 'card show: 그 카드의 세션 기록을 보여 줍니다' },
  { name: 'propose', summary: '쓰지 않고 세션에 제안과 diff 만 남깁니다 (card apply 로 받음)' },
  { name: 'value', valueLabel: '<value>', summary: 'config set 이 넣을 값' },
  { name: 'dry-run', summary: '반영하지 않고 대상만 보고합니다' },
  { name: 'pending', summary: 'outline show: 적용을 기다리는 시놉시스 후보를 보여 줍니다' },
  { name: 'show', summary: 'manuscript review: 마지막 수정 계획을 읽기만 합니다 (모델 호출 없음)' },
  {
    name: 'scenes',
    valueLabel: '<범위>',
    summary: 'card interview: 질문을 뽑을 씬 (stem 을 쉼표로, 또는 3..5 처럼 번호 범위; 기본은 초안 없는 다음 씬들)',
  },
  { name: 'limit', valueLabel: '<n>', summary: 'card interview: 이 세션에서 답할 질문 수 상한' },
  {
    name: 'reset-axes',
    summary: 'card interview: 축 어휘와 모든 카드의 표·작업 모델을 비우고 다시 뽑습니다 (카드는 그대로)',
  },
  {
    name: 'ask-known',
    summary: 'card interview: 카드에 이미 적힌 상대별 호칭·말투도 다시 묻습니다',
  },
  {
    name: 'step',
    summary: 'card interview: 한 단계만 돌고 질문을 JSON 으로 내고 끝냅니다 (--json 필요, 에이전트가 작가에게 질문을 전할 때)',
  },
  { name: 'session', valueLabel: '<id>', summary: 'card interview --step: 이을 세션 (생략하면 그 카드의 열린 세션)' },
  { name: 'answer', valueLabel: '<n>', summary: 'card interview --step: 작가가 고른 선택지 번호' },
  { name: 'write', valueLabel: '<text>', summary: 'card interview --step: 작가가 직접 쓴 답' },
  { name: 'skip', summary: 'card interview --step: 이 질문을 건너뜁니다' },
  { name: 'confirm', valueLabel: '<n>', summary: 'card interview --step: 직접 쓴 답을 읽은 값 확인 (1 = 맞다)' },
  { name: 'rename', valueLabel: '<name>', summary: 'card interview --step: 직접 쓴 답에 새 값 이름을 붙입니다' },
  { name: 'finish', summary: 'card interview --step: 세션을 끝내고 카드 제안으로 증류합니다' },
  { name: 'abandon', summary: 'card interview --step: 증류 없이 세션을 닫습니다 (답한 표는 남음)' },
  {
    name: 'replace-candidates',
    summary: 'notes absorb: 앞선 흡수가 남긴 노트 후보를 버리고 이번 후보만 남깁니다',
  },
  { name: 'json', summary: '결과를 JSON 으로 stdout 에 출력합니다 (실패도 JSON)' },
  { name: 'quiet', summary: '진행 로그를 숨깁니다 (기본: 터미널이면 stderr 에 표시)' },
  { name: 'verbose', summary: '터미널이 아니어도 진행 로그를 stderr 에 출력합니다' },
  { name: 'no-color', summary: '색을 끕니다 (NO_COLOR 환경 변수와 같음)' },
  { name: 'version', summary: '버전을 출력합니다 (-v)' },
  { name: 'help', summary: '이 도움말 또는 <명령> --help (-h)' },
];

export const booleanFlagNames: ReadonlySet<string> = new Set(
  flagCatalog.filter((flag) => flag.valueLabel === undefined).map((flag) => flag.name),
);

export const valueFlagNames: ReadonlySet<string> = new Set(
  flagCatalog.filter((flag) => flag.valueLabel !== undefined).map((flag) => flag.name),
);

export function findFlagSpec(name: string): FlagSpec | undefined {
  return flagCatalog.find((flag) => flag.name === name);
}
