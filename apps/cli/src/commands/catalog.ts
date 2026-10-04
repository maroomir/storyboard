import {
  compositionKinds,
  compositionPresetDefaults,
  narrativeTenses,
  narratorKnowledges,
  narratorPersons,
  pointOfViews,
} from '@storyboard/story-model';
import { draftCheckKinds } from '@storyboard/story-engine';

export type CommandGroup =
  | '시작하기'
  | '기획'
  | '씬'
  | '초안'
  | '카드와 정전'
  | '노트'
  | '원고'
  | '측정';

// 어느 verb 에나 붙는 옵션. 최상위 도움말·verb 도움말·자동완성이 같은 목록을 봐야 «있다고 적혀
// 있는데 완성되지 않는» 옵션이 생기지 않는다.
export const globalFlagNames = [
  'workspace',
  'provider',
  'model',
  'json',
  'quiet',
  'verbose',
  'no-color',
  'help',
  'version',
] as const;

// verb 도움말 아래에 늘 붙는 짧은 목록.
export const sharedFlagNames = ['workspace', 'json', 'quiet', 'verbose'] as const;

export const completionShells = ['zsh', 'bash', 'fish'] as const;

export type CompletionShell = (typeof completionShells)[number];

export const initLanguages = ['ko', 'en', 'ja'] as const;

// 종류는 명령 이름이 아니라 첫 인자다. usage 의 <type>·<kind> 칸, 핸들러의 검사, 자동완성이 같은
// 목록을 본다.
export const cardCategories = ['character', 'background'] as const;

export type CardCategory = (typeof cardCategories)[number];

export { draftCheckKinds, type DraftCheckKind } from '@storyboard/story-engine';

export const noteSources = ['notion'] as const;

// `config show` 가 프로바이더마다 보여 주는 칸과, `config set` 이 실제로 쓸 수 있는 칸. 두 목록이
// 다른 것은 뜻이 있어서다 — 보여 주기만 하는 값이 있다.
export const displayedProviderKeys = ['model', 'baseUrl', 'contextTokens'] as const;

export const settableProviderKeys = ['model', 'baseUrl', 'contextTokens'] as const;

export type SettableProviderKey = (typeof settableProviderKeys)[number];

export const commandGroups: readonly CommandGroup[] = [
  '시작하기',
  '기획',
  '씬',
  '초안',
  '카드와 정전',
  '노트',
  '원고',
  '측정',
];

// `help <묶음>` 으로 칠 수 있는 이름. 한글 묶음 이름은 셸에서 띄어쓰기와 IME 때문에 치기 어렵다.
export const commandGroupIds: Readonly<Record<CommandGroup, string>> = {
  시작하기: 'start',
  기획: 'plan',
  씬: 'scene',
  초안: 'draft',
  '카드와 정전': 'card',
  노트: 'notes',
  원고: 'manuscript',
  측정: 'sim',
};

export function findCommandGroup(topic: string): CommandGroup | undefined {
  const needle = topic.trim().toLowerCase();
  return commandGroups.find((group) => group === needle || commandGroupIds[group] === needle);
}

export interface CommandSpec {
  readonly verb: string;
  readonly group: CommandGroup;
  readonly usage: string;
  readonly summary: string;
  readonly flags?: readonly string[];
  readonly examples?: readonly string[];
  // `init` creates the workspace and the setup verbs are machine-wide, so they cannot demand one.
  readonly needsWorkspace?: false;
  // Changes the workspace, so it takes the workspace run lock for its duration and refuses while
  // another app (the desktop, the extension, another CLI) holds it.
  readonly writesWorkspace?: true;
}

export interface FlagSpec {
  readonly name: string;
  readonly valueLabel?: string;
  readonly summary: string;
}

// One table drives the parser (which flags take a value), `--help`, per-verb help and the README.
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
    summary: 'init: 만든 워크스페이스에 노트를 흡수합니다 (Obsidian 폴더·노트 또는 Notion 주소)',
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
      '이미 있는 결과를 덮어씁니다 (draft generate, scene plot, scene seed, outline generate)',
  },
  { name: 'out', valueLabel: '<path>', summary: 'manuscript export 의 출력 파일' },
  { name: 'lines', valueLabel: '<a-b>', summary: '대상 줄 범위 (없으면 본문 전체)' },
  { name: 'instruction', valueLabel: '<text>', summary: 'draft augment/edit 에 줄 지시' },
  { name: 'name', valueLabel: '<text>', summary: 'card/scene create 가 쓸 이름' },
  { name: 'id', valueLabel: '<slug>', summary: 'card create 의 파일명 (기본: 이름에서 유도)' },
  { name: 'to', valueLabel: '<id>', summary: 'card rename 의 새 id, scene rename 의 새 stem' },
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
    // NOTE: 도움말은 번들 기본값을 보인다. 작가의 compositionPresets.json 은 작품 명령이 돌 때 덮인다.
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
    summary: `narrator create: 인칭 (${narratorPersons.join(', ')})`,
  },
  {
    name: 'knowledge',
    valueLabel: '<value>',
    summary: `narrator create: 지식 경계 (${narratorKnowledges.join(', ')})`,
  },
  {
    name: 'tense',
    valueLabel: '<value>',
    summary: `narrator create: 시제 (${narrativeTenses.join(', ')})`,
  },
  { name: 'focal', valueLabel: '<id>', summary: 'narrator create: 초점 인물 카드 id' },
  { name: 'voice', valueLabel: '<text>', summary: 'narrator create: 서술자 목소리 (쉼표로 구분)' },
  { name: 'target-words', valueLabel: '<n>', summary: '작품 계약: 목표 분량(자)' },
  { name: 'chapters', valueLabel: '<n>', summary: '작품 계약: 장 수' },
  { name: 'scenes-per-chapter', valueLabel: '<n>', summary: '작품 계약: 장당 씬 수' },
  { name: 'concept', valueLabel: '<text>', summary: '작품 계약: 한 줄 콘셉트' },
  { name: 'description', valueLabel: '<text>', summary: '작품 계약: 설명' },
  { name: 'key', valueLabel: '<key>', summary: 'config set 이 바꿀 설정 키' },
  { name: 'value', valueLabel: '<value>', summary: 'config set 이 넣을 값' },
  { name: 'dry-run', summary: '반영하지 않고 대상만 보고합니다' },
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

export const commandCatalog: readonly CommandSpec[] = [
  {
    verb: 'init',
    group: '시작하기',
    usage: 'init --title <name> | init --repair',
    summary:
      '현재 디렉터리를 Storyboard 워크스페이스로 만듭니다 (작품 계약도 함께 받고, git 저장소가 아니면 git init 도 합니다 — 첫 커밋은 직접). --repair 는 0.8 이전 워크스페이스의 발판을 보수하고 이야기 상태 원장을 봉인합니다',
    flags: [
      'title',
      'repair',
      'language',
      'from',
      'genre',
      'audience',
      'pov',
      'target-words',
      'chapters',
      'scenes-per-chapter',
      'concept',
      'description',
      'composition',
      'episodes',
      'pov-characters',
      'from-notes',
      'yes',
      'dry-run',
    ],
    examples: [
      'storyboard init --title "밤의 항해"',
      'storyboard init --title "밤의 항해" --genre 미스터리 --audience 성인 --pov third-limited --target-words 300000',
      'storyboard init --repair',
      'storyboard init --title "달의 문" --from-notes ~/Vault/달의문',
      'storyboard init --title "네 개의 밤" --composition omnibus --episodes 4',
    ],
    needsWorkspace: false,
  },
  {
    verb: 'setup',
    group: '시작하기',
    usage: 'setup [--provider <id>] [--global]',
    summary:
      '기본 AI 프로바이더와 API 키를 정합니다 (터미널이면 질문, 아니면 --provider). 설정은 이 작품에, --global 이면 모든 작품에 저장합니다',
    flags: ['provider', 'model', 'global'],
    examples: ['storyboard setup', 'storyboard setup --provider claude --global'],
    needsWorkspace: false,
  },
  {
    verb: 'apikey set',
    group: '시작하기',
    usage: 'apikey set [<provider>]',
    summary:
      'API 키를 저장합니다. 터미널이면 프로바이더를 고르고 키를 가려진 입력으로 받아 바로 연결을 확인하고, 파이프면 stdin 에서 읽습니다 (빈 입력이면 삭제)',
    examples: [
      'storyboard apikey set',
      'storyboard apikey set claude',
      'echo "$OPENAI_API_KEY" | storyboard apikey set openai',
    ],
    needsWorkspace: false,
  },
  {
    verb: 'apikey show',
    group: '시작하기',
    usage: 'apikey show',
    summary: '어느 프로바이더의 API 키가 저장돼 있는지 보여 줍니다 (값은 보이지 않습니다)',
    examples: ['storyboard apikey show'],
    needsWorkspace: false,
  },
  {
    verb: 'config show',
    group: '시작하기',
    usage: 'config show',
    summary: '적용 중인 설정과 출처(공통/이 작품/기본값)를 보여 줍니다',
    needsWorkspace: false,
  },
  {
    verb: 'config set',
    group: '시작하기',
    usage: 'config set <key> <value> [--global]',
    summary:
      '이 작품의 .storyboard/config.json 값을 바꿉니다 (--global 이면 ~/.storyboard/config.json)',
    flags: ['global'],
    examples: [
      'storyboard config set defaultProvider claude',
      'storyboard config set revise.loop.maxIterations 3',
    ],
    needsWorkspace: false,
  },
  {
    verb: 'params show',
    group: '시작하기',
    usage: 'params show',
    summary:
      '작가가 움직일 수 있는 값 전부(설정·생성 손잡이·프롬프트 온도)와 출처, 적용된 리소스 파일을 보여 줍니다',
    examples: ['storyboard params show', 'storyboard params show --json'],
    needsWorkspace: false,
  },
  {
    verb: 'doctor',
    group: '시작하기',
    usage: 'doctor',
    summary:
      '설정 파일·프로바이더·API 키·CLI 실행 파일과 로그인·워크스페이스·이야기 상태 원장을 점검합니다 (init --repair 로 보수)',
    examples: ['storyboard doctor', 'storyboard doctor --json'],
    needsWorkspace: false,
  },
  {
    verb: 'status',
    group: '시작하기',
    usage: 'status',
    summary:
      '작품 현황(계약·아웃라인·카드·씬·초안·정전 후보·원고)과 다음에 실행할 명령을 보여 줍니다',
    examples: ['storyboard status', 'storyboard status --json | jq -r .data.next.command'],
  },
  {
    verb: 'completion',
    group: '시작하기',
    usage: `completion <${completionShells.join('|')}>`,
    summary: '셸 Tab 완성 스크립트를 출력합니다',
    examples: ['eval "$(storyboard completion zsh)"', 'storyboard completion fish | source'],
    needsWorkspace: false,
  },
  {
    verb: 'tui',
    group: '시작하기',
    usage: 'tui',
    summary: '대화형 화면을 엽니다 (터미널에서 인자 없이 실행해도 같음)',
    needsWorkspace: false,
  },
  {
    verb: 'help',
    group: '시작하기',
    usage: 'help [command | group] [--all]',
    summary: '명령 묶음, 한 묶음 또는 한 명령의 도움말 (--all 은 전체 명령)',
    flags: ['all'],
    examples: ['storyboard help draft', 'storyboard help draft generate', 'storyboard help --all'],
    needsWorkspace: false,
  },
  {
    verb: 'project show',
    group: '기획',
    usage: 'project show',
    summary: '작품 이름과 계약(장르·독자층·시점·분량·구성)을 보여 줍니다',
    examples: ['storyboard project show', 'storyboard project show --json'],
  },
  {
    verb: 'project set',
    writesWorkspace: true,
    group: '기획',
    usage: 'project set [--genre …]',
    summary: '작품 계약을 고칩니다 (적지 않은 항목은 그대로 둡니다)',
    flags: [
      'from',
      'genre',
      'audience',
      'pov',
      'target-words',
      'chapters',
      'scenes-per-chapter',
      'concept',
      'description',
      'composition',
      'episodes',
      'pov-characters',
    ],
    examples: [
      'storyboard project set --target-words 320000',
      'storyboard project set --composition alternating-pov --pov-characters hana,jun',
      'storyboard project set --from contract.json',
    ],
  },
  {
    verb: 'outline generate',
    writesWorkspace: true,
    group: '기획',
    usage: 'outline generate',
    summary: '작품 계약에서 시놉시스와 챕터 계획을 만듭니다',
    flags: ['force'],
  },
  {
    verb: 'narrator list',
    group: '기획',
    usage: 'narrator list',
    summary: '서술자 카드를 봅니다 (없으면 작품 계약의 시점 하나가 모든 씬에 적용됩니다)',
  },
  {
    verb: 'narrator show',
    group: '기획',
    usage: 'narrator show <id>',
    summary: '서술자 하나의 인칭·지식 경계·시제·목소리를 봅니다',
  },
  {
    verb: 'narrator create',
    writesWorkspace: true,
    group: '기획',
    usage: 'narrator create <id> [--person …]',
    summary: '이름 붙인 서술자 카드를 만듭니다 (씬·장이 골라 쓰는 시점)',
    flags: ['id', 'name', 'person', 'knowledge', 'tense', 'focal', 'voice'],
    examples: [
      'storyboard narrator create hana-first --person first --focal hana',
      'storyboard narrator create narrator-old --person first --knowledge retrospective --focal hana',
    ],
  },
  {
    verb: 'narrator remove',
    writesWorkspace: true,
    group: '기획',
    usage: 'narrator remove <id>',
    summary: '서술자 카드를 지웁니다',
  },
  {
    verb: 'novel generate',
    writesWorkspace: true,
    group: '기획',
    usage: 'novel generate',
    summary: '기획부터 원고 조립까지 한 번에 돌립니다 (모든 승인 자동)',
    flags: ['revise-iterations'],
  },
  {
    verb: 'scene list',
    group: '씬',
    usage: 'scene list',
    summary: '씬 카드를 번호순으로, 초안이 있는지와 함께 봅니다',
    examples: ['storyboard scene list', 'storyboard scene list --json | jq -r ".data.scenes[].stem"'],
  },
  {
    verb: 'scene show',
    group: '씬',
    usage: 'scene show <stem>',
    summary: '씬 카드의 내용과 이 씬에 적용될 시점·줄기를 보여 줍니다',
    examples: ['storyboard scene show 03-night-market'],
  },
  {
    verb: 'scene create',
    writesWorkspace: true,
    group: '씬',
    usage: 'scene create --name <text>',
    summary: '다음 번호로 씬 카드를 만듭니다',
    flags: ['name'],
  },
  {
    verb: 'scene rename',
    writesWorkspace: true,
    group: '씬',
    usage: 'scene rename <stem> --to <stem>',
    summary: '씬 이름·번호를 바꾸고 초안·기억·정전의 참조를 함께 옮깁니다',
    flags: ['to'],
    examples: ['storyboard scene rename 03-night-market --to 04-night-market'],
  },
  {
    verb: 'scene seed',
    writesWorkspace: true,
    group: '씬',
    usage: 'scene seed',
    summary: '아웃라인에서 씬 시드를 만듭니다',
    flags: ['force'],
  },
  {
    verb: 'scene plot',
    writesWorkspace: true,
    group: '씬',
    usage: 'scene plot <stem> | --all',
    summary:
      '씬 카드의 사건 비트를 전개해 beats 필드에 씁니다 (--force 로 다시, --dry-run 은 제안만)',
    flags: ['all', 'force', 'dry-run'],
    examples: ['storyboard scene plot 01-scene-1-1', 'storyboard scene plot --all --dry-run'],
  },
  {
    verb: 'scene complete',
    writesWorkspace: true,
    group: '씬',
    usage: 'scene complete',
    summary: '끝번호 뒤에 붙일 완결 씬을 만듭니다 (--dry-run 은 제안만)',
    flags: ['dry-run'],
  },
  {
    verb: 'draft generate',
    writesWorkspace: true,
    group: '초안',
    usage: 'draft generate <stem> | --all',
    summary: '씬 초안을 생성합니다 (--force 로 재생성, --all 은 필요한 씬만)',
    flags: ['all', 'force', 'no-revise', 'revise-iterations'],
    examples: ['storyboard draft generate 01-scene-1-1', 'storyboard draft generate --all'],
  },
  {
    verb: 'draft revise',
    writesWorkspace: true,
    group: '초안',
    usage: 'draft revise <stem>',
    summary: '기존 초안을 검수하고 재작성합니다',
    flags: ['revise-iterations'],
  },
  {
    verb: 'draft show',
    group: '초안',
    usage: 'draft show <stem>',
    summary: '초안 본문을 출력합니다 (--json 이면 경로·분량·생성 정보도)',
    examples: [
      'storyboard draft show 01-scene-1-1',
      'storyboard draft show 01-scene-1-1 --json | jq -r .data.path',
    ],
  },
  {
    verb: 'draft edit',
    writesWorkspace: true,
    group: '초안',
    usage: 'draft edit <stem> --instruction <text>',
    summary: '지시대로 고칩니다 (--lines 로 구간 지정)',
    flags: ['instruction', 'lines'],
  },
  {
    verb: 'draft augment',
    writesWorkspace: true,
    group: '초안',
    usage: 'draft augment <stem>',
    summary: '갱신된 카드·정전을 기존 초안에 녹입니다',
    flags: ['lines', 'instruction', 'dry-run'],
  },
  {
    verb: 'draft condense',
    writesWorkspace: true,
    group: '초안',
    usage: 'draft condense <stem>',
    summary: '초안을 압축합니다',
    flags: ['lines'],
  },
  {
    verb: 'draft expand',
    writesWorkspace: true,
    group: '초안',
    usage: 'draft expand <stem>',
    summary: '초안을 늘립니다',
    flags: ['lines'],
  },
  {
    verb: 'draft format',
    writesWorkspace: true,
    group: '초안',
    usage: 'draft format <stem>',
    summary: '초안을 프로젝트 형식으로 다시 씁니다',
  },
  {
    verb: 'draft check',
    group: '초안',
    usage: `draft check <${draftCheckKinds.join('|')}> <stem>`,
    summary:
      '초안을 검사합니다 — grammar 문법, continuity 정전과 어긋나는 곳, slop 상투 표현(AI 호출 없음). 문제가 있으면 종료 코드 1',
    examples: [
      'storyboard draft check slop 01-scene-1-1',
      'storyboard draft check continuity 01-scene-1-1 --json',
    ],
  },
  {
    verb: 'state reseal',
    writesWorkspace: true,
    group: '초안',
    usage: 'state reseal [<씬 범위>]',
    summary:
      '카드를 고쳤지만 지금 초안이 맞다고 보고 이야기 상태 원장을 다시 봉인합니다 (범위를 비우면 낡은 씬 전부)',
    examples: ['storyboard state reseal', 'storyboard state reseal 5-32'],
  },
  {
    verb: 'card list',
    group: '카드와 정전',
    usage: `card list [${cardCategories.join('|')}]`,
    summary: '인물·배경 카드를 봅니다 (종류를 적으면 그 종류만)',
    examples: ['storyboard card list', 'storyboard card list character --json'],
  },
  {
    verb: 'card show',
    group: '카드와 정전',
    usage: 'card show <id>',
    summary: '카드 하나의 내용을 봅니다 (인물에서 먼저 찾고 배경에서 찾습니다)',
    examples: ['storyboard card show hana'],
  },
  {
    verb: 'card create',
    writesWorkspace: true,
    group: '카드와 정전',
    usage: `card create <${cardCategories.join('|')}> --name <text>`,
    summary: '빈 인물·배경 카드를 만듭니다',
    flags: ['name', 'id'],
    examples: [
      'storyboard card create character --name "서진아" --id seo-jina',
      'storyboard card create background --name "Night Market"',
    ],
  },
  {
    verb: 'card rename',
    writesWorkspace: true,
    group: '카드와 정전',
    usage: `card rename <${cardCategories.join('|')}> <id> --to <id>`,
    summary: '카드 id 를 바꾸고 참조를 함께 고칩니다',
    flags: ['to'],
    examples: ['storyboard card rename character hana --to hana-seo'],
  },
  {
    verb: 'card recommend',
    group: '카드와 정전',
    usage: `card recommend <${cardCategories.join('|')}>`,
    summary: '카드가 없는 인물·배경을 찾습니다 (읽기 전용)',
    examples: ['storyboard card recommend character'],
  },
  {
    verb: 'card build',
    writesWorkspace: true,
    group: '카드와 정전',
    usage: 'card build',
    summary: '씬만 읽어 카드를 만듭니다 (--dry-run 은 제안만)',
    flags: ['dry-run'],
  },
  {
    verb: 'card promote',
    writesWorkspace: true,
    group: '카드와 정전',
    usage: 'card promote',
    summary: '초안과 노트에서 나온 카드 후보를 반영합니다',
    flags: ['dry-run'],
  },
  {
    verb: 'canon diff',
    group: '카드와 정전',
    usage: 'canon diff',
    summary: '정전에 아직 없는 설정 후보를 보고합니다 (읽기 전용)',
  },
  {
    verb: 'canon promote',
    writesWorkspace: true,
    group: '카드와 정전',
    usage: 'canon promote',
    summary: '초안에서 추출한 설정 후보를 정전에 반영합니다',
    flags: ['dry-run'],
  },
  {
    verb: 'notes connect',
    group: '노트',
    usage: `notes connect [${noteSources.join('|')}]`,
    summary: 'Notion 통합 토큰을 secrets.json 에 저장합니다 (표준 입력도 받습니다, 비우면 삭제)',
    examples: ['storyboard notes connect notion'],
    needsWorkspace: false,
  },
  {
    verb: 'notes absorb',
    writesWorkspace: true,
    group: '노트',
    usage: 'notes absorb <path|url>',
    summary:
      'Obsidian 폴더·노트나 Notion 페이지를 하위 페이지까지 읽어 인물·배경·씬 카드와 시놉시스로 옮깁니다 (견적을 먼저 보여 줍니다, 기존 카드는 후보로만)',
    flags: ['yes', 'dry-run'],
    examples: [
      'storyboard notes absorb ~/Vault/달의문',
      'storyboard notes absorb https://www.notion.so/team/Moon-Gate-1429989fe8ac4effbc8f57f56486db54 --yes',
      'storyboard notes absorb ~/Vault/달의문 --yes --dry-run',
    ],
  },
  {
    verb: 'manuscript assemble',
    writesWorkspace: true,
    group: '원고',
    usage: 'manuscript assemble',
    summary: 'draft/ 를 원고로 조립합니다',
  },
  {
    verb: 'manuscript review',
    writesWorkspace: true,
    group: '원고',
    usage: 'manuscript review',
    summary: '조립 원고를 검사합니다',
  },
  {
    verb: 'manuscript summarize',
    writesWorkspace: true,
    group: '원고',
    usage: 'manuscript summarize',
    summary: '장별 요약을 만듭니다',
  },
  {
    verb: 'manuscript export',
    group: '원고',
    usage: 'manuscript export [--out <path>]',
    summary: '조립 원고를 stdout 또는 --out 파일로 냅니다',
    flags: ['out'],
  },
  {
    verb: 'sim run',
    group: '측정',
    usage: 'sim run --track <path> [--genre <name>]',
    summary: '트랙 한 벌을 한 지점으로 돌리고 품질·비용을 잽니다',
    flags: [
      'track',
      'config',
      'genre',
      'overlay',
      'repeats',
      'judge',
      'judge-model',
      'out',
      'provider',
      'model',
      'prompt-variant',
      'yes',
    ],
    examples: [
      'storyboard sim run --track ~/storyboard-workspace --genre thriller',
      'storyboard sim run --track ~/storyboard-workspace --overlay point.json --yes',
    ],
    needsWorkspace: false,
  },
  {
    verb: 'sim screen',
    group: '측정',
    usage: 'sim screen --track <path> [--knobs <a,b,c>]',
    summary: '손잡이를 하나씩 흔들어 영향이 큰 것을 고릅니다 (심판 없이)',
    flags: [
      'track',
      'config',
      'genre',
      'knobs',
      'repeats',
      'max-runs',
      'out',
      'provider',
      'model',
      'yes',
    ],
    examples: ['storyboard sim screen --track ~/storyboard-workspace'],
    needsWorkspace: false,
  },
  {
    verb: 'sim sweep',
    group: '측정',
    usage: 'sim sweep --track <path> --knobs <a,b,c,d>',
    summary: '고른 손잡이 넷으로 격자를 돌고 파레토 표를 냅니다',
    flags: [
      'track',
      'config',
      'genre',
      'knobs',
      'repeats',
      'max-runs',
      'judge',
      'judge-model',
      'out',
      'provider',
      'model',
      'prompt-variant',
      'yes',
    ],
    examples: [
      'storyboard sim sweep --track ~/storyboard-workspace --knobs skeleton.lengthRatio,generation.section.retryLimit,generation.dialogue.preservedRatio,generation.padding.paragraphRatio',
    ],
    needsWorkspace: false,
  },
  {
    verb: 'sim report',
    group: '측정',
    usage: 'sim report --out <path>',
    summary: '쌓인 결과를 표로 다시 그립니다 (AI 호출 없음)',
    flags: ['out'],
    examples: ['storyboard sim report --out runs.jsonl'],
    needsWorkspace: false,
  },
  {
    verb: 'sim rejudge',
    group: '측정',
    usage:
      'sim rejudge --track <path> --genre <name> --judge <provider> --judge-model <name> [--point <label>] [--source <engine>] [--yes]',
    summary: '저장된 원고를 다른 심판으로 다시 채점합니다 (생성은 하지 않습니다)',
    flags: ['track', 'config', 'genre', 'point', 'source', 'judge', 'judge-model', 'out', 'yes'],
    examples: [
      'storyboard sim rejudge --track . --genre thriller --judge claude --judge-model claude-sonnet-5 --yes',
    ],
    needsWorkspace: false,
  },
  {
    verb: 'sim apply',
    group: '측정',
    usage: 'sim apply --out <path> --point <label> [--dry-run] [--force] [--profiles <path>]',
    summary: '고른 지점을 모델 프로필에 적습니다',
    flags: ['out', 'point', 'dry-run', 'force', 'profiles'],
    examples: ['storyboard sim apply --out runs.jsonl --point grid:0120 --dry-run'],
    needsWorkspace: false,
  },
];

export function findCommandSpec(verb: string): CommandSpec | undefined {
  return commandCatalog.find((spec) => spec.verb === verb);
}

export function findFlagSpec(name: string): FlagSpec | undefined {
  return flagCatalog.find((flag) => flag.name === name);
}
