import {
  commandCatalog,
  commandGroupIds,
  commandGroups,
  findCommandGroup,
  findCommandSpec,
  findFlagSpec,
  flagCatalog,
  globalFlagNames,
  sharedFlagNames,
  type CommandGroup,
  type CommandSpec,
} from './commands/catalog';
import { renderColumns, type ColumnRow } from './terminal/layout';
import { plainTerminalStream, type TerminalStream } from './terminal/profile';

// 도움말은 세 겹이다. 맨 처음 화면은 묶음만, `help <묶음>` 은 한 묶음의 명령, `help --all` 은 전부.
// 60 개가 넘는 명령을 한 화면에 쏟으면 처음 온 사람은 어디서 시작할지 찾지 못한다.

// Lines longer than this are hard to read even on a wide terminal.
const maximumHelpWidth = 100;

function helpWidth(stream: TerminalStream): number {
  return Math.min(stream.columns, maximumHelpWidth);
}

function paintUsage(usage: string, verb: string, stream: TerminalStream): string {
  const { paint } = stream.theme;
  return usage.startsWith(verb)
    ? `${paint('accent', verb)}${paint('muted', usage.slice(verb.length))}`
    : paint('accent', usage);
}

function describeCommand(spec: CommandSpec, stream: TerminalStream): ColumnRow {
  return { label: paintUsage(spec.usage, spec.verb, stream), description: spec.summary };
}

function describeFlag(name: string, stream: TerminalStream): ColumnRow {
  const flag = findFlagSpec(name);
  const { paint } = stream.theme;

  if (!flag) {
    return { label: paint('accent', `--${name}`), description: '' };
  }

  const value = flag.valueLabel === undefined ? '' : paint('muted', ` ${flag.valueLabel}`);
  return { label: `${paint('accent', `--${flag.name}`)}${value}`, description: flag.summary };
}

function renderSection(
  title: string,
  rows: readonly ColumnRow[],
  stream: TerminalStream,
  maximumLabelWidth?: number,
): string[] {
  return [
    stream.theme.paint('heading', title),
    ...renderColumns(rows, {
      availableWidth: helpWidth(stream),
      ...(maximumLabelWidth === undefined ? {} : { maximumLabelWidth }),
    }),
  ];
}

function commandsInGroup(group: CommandGroup): CommandSpec[] {
  return commandCatalog.filter((spec) => spec.group === group);
}

// Wide enough for the init line, so the six steps read as one aligned column.
const gettingStartedLabelWidth = 40;

// The first screen a new install sees, so the commands that make the CLI usable come first.
function renderGettingStarted(stream: TerminalStream): string[] {
  const steps: readonly ColumnRow[] = [
    { label: 'init --title "작품 이름"', description: '빈 디렉터리를 워크스페이스로' },
    { label: 'setup', description: 'AI 프로바이더와 키 설정 (익스텐션과 공유)' },
    { label: 'outline generate', description: '작품 계약에서 시놉시스·챕터 계획' },
    { label: 'scene seed', description: '챕터 계획에서 씬 시드' },
    { label: 'draft generate --all', description: '초안 생성 (검수·수정 포함)' },
    { label: 'manuscript assemble', description: '원고 조립' },
  ];
  const numbered = steps.map((step, index) => ({
    label: `${stream.theme.paint('muted', `${index + 1}`)} ${stream.theme.paint('accent', `storyboard ${step.label}`)}`,
    description: step.description,
  }));

  return [
    ...renderSection('처음이라면', numbered, stream, gettingStartedLabelWidth),
    '',
    `  ${stream.theme.paint('accent', 'storyboard status')} 가 다음에 할 일을, ${stream.theme.paint('accent', 'storyboard doctor')} 가 빠진 설정을 알려 줍니다.`,
  ];
}

function renderHeader(version: string, stream: TerminalStream): string[] {
  const { paint } = stream.theme;
  return [
    `${paint('heading', 'storyboard')} ${version} ${paint('muted', '— 장편 소설을 터미널에서')}`,
    '',
    `${paint('heading', '사용법')}  storyboard ${paint('muted', '<명령> [대상] [--옵션]')}`,
  ];
}

function renderFooter(stream: TerminalStream): string[] {
  return renderSection(
    '설정 파일',
    [
      {
        label: 'config.json',
        description:
          '~/.storyboard/config.json (공통) · <워크스페이스>/.storyboard/config.json (이 작품)',
      },
      { label: 'secrets.json', description: '~/.storyboard/secrets.json (0600)' },
    ],
    stream,
  );
}

// What a reader scans a group for: its nouns (`card · canon`), or for a one-noun group its actions
// (`list · show · create`), since repeating `scene` beside the scene group says nothing.
function summarizeGroup(group: CommandGroup): string {
  const specs = commandsInGroup(group);
  const nouns = [...new Set(specs.map((spec) => spec.verb.split(' ')[0] ?? spec.verb))];
  const names =
    nouns.length === 1 ? specs.map((spec) => spec.verb.split(' ').slice(1).join(' ')) : nouns;
  return names.join(' · ');
}

export function renderGroupList(stream: TerminalStream = plainTerminalStream): string[] {
  const { paint } = stream.theme;
  const groupRows = commandGroups
    .filter((group) => commandsInGroup(group).length > 0)
    .map((group) => ({
      label: `${paint('accent', commandGroupIds[group].padEnd(10))} ${group}`,
      description: summarizeGroup(group),
    }));

  return renderSection('명령 묶음', groupRows, stream);
}

export function renderUsage(version = '', stream: TerminalStream = plainTerminalStream): string {
  return [
    ...renderHeader(version, stream),
    '',
    ...renderGettingStarted(stream),
    '',
    ...renderGroupList(stream),
    '',
    ...renderSection(
      '도움말 더 보기',
      [
        {
          label: 'storyboard help <묶음>',
          description: '한 묶음의 명령 (예: storyboard help draft)',
        },
        { label: 'storyboard <명령> --help', description: '한 명령의 옵션과 예시' },
        { label: 'storyboard help --all', description: '모든 명령을 한 번에' },
      ],
      stream,
    ),
    '',
    ...renderSection(
      '공통 옵션',
      globalFlagNames.map((name) => describeFlag(name, stream)),
      stream,
    ),
    '',
    ...renderFooter(stream),
    '',
  ].join('\n');
}

export function renderFullUsage(
  version = '',
  stream: TerminalStream = plainTerminalStream,
): string {
  const sections: string[] = [
    ...renderHeader(version, stream),
    '',
    ...renderGettingStarted(stream),
  ];

  for (const group of commandGroups) {
    const specs = commandsInGroup(group);

    if (specs.length > 0) {
      sections.push(
        '',
        ...renderSection(
          group,
          specs.map((spec) => describeCommand(spec, stream)),
          stream,
        ),
      );
    }
  }

  sections.push(
    '',
    ...renderSection(
      '공통 옵션',
      globalFlagNames.map((name) => describeFlag(name, stream)),
      stream,
    ),
    '',
    ...renderFooter(stream),
    '',
  );

  return sections.join('\n');
}

export function renderGroupHelp(
  topic: string,
  stream: TerminalStream = plainTerminalStream,
): string | undefined {
  const group = findCommandGroup(topic);

  if (group === undefined) {
    return undefined;
  }

  const { paint } = stream.theme;
  return [
    `${paint('heading', group)} ${paint('muted', `(${commandGroupIds[group]})`)}`,
    ...renderColumns(
      commandsInGroup(group).map((spec) => describeCommand(spec, stream)),
      { availableWidth: helpWidth(stream) },
    ),
    '',
    paint('muted', '한 명령의 옵션과 예시: storyboard <명령> --help'),
    '',
  ].join('\n');
}

export function renderCommandHelp(
  verb: string,
  stream: TerminalStream = plainTerminalStream,
): string | undefined {
  const spec = findCommandSpec(verb);

  if (!spec) {
    return undefined;
  }

  const lines = [
    `storyboard ${paintUsage(spec.usage, spec.verb, stream)}`,
    '',
    ...renderColumns([{ label: '', description: spec.summary }], {
      availableWidth: helpWidth(stream),
      gap: 0,
    }),
  ];

  if (spec.flags && spec.flags.length > 0) {
    lines.push(
      '',
      ...renderSection(
        '옵션',
        spec.flags.map((name) => describeFlag(name, stream)),
        stream,
      ),
    );
  }

  lines.push(
    '',
    ...renderSection(
      '공통 옵션',
      sharedFlagNames.map((name) => describeFlag(name, stream)),
      stream,
    ),
  );

  if (spec.examples && spec.examples.length > 0) {
    lines.push(
      '',
      stream.theme.paint('heading', '예시'),
      ...spec.examples.map((example) => `  ${example}`),
    );
  }

  lines.push('');
  return lines.join('\n');
}

// `help <topic>` takes a command first, then a group: `help status` is the command, `help draft`
// (not a command on its own) is the group.
export function renderHelpTopic(
  topic: string,
  stream: TerminalStream = plainTerminalStream,
): string | undefined {
  return renderCommandHelp(topic, stream) ?? renderGroupHelp(topic, stream);
}

// A wrong verb is usually a near miss on a real one; naming the closest ones beats dumping the
// whole usage screen the author already scrolled past.
export function suggestVerbs(input: string, limit = 3): string[] {
  const needle = input.trim().toLowerCase();

  if (needle.length === 0) {
    return [];
  }

  const scored = commandCatalog
    .map((spec) => ({ verb: spec.verb, score: similarity(needle, spec.verb.toLowerCase()) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((entry) => entry.verb);
}

const prefixScore = 10;
const sameActionScore = 4;
const sharedWordScore = 2;
const nearWordScore = 1;
const nearWordDistance = 2;

// The action counts for more than the noun: a command that moved to another noun
// (`scene generate` → `draft generate`) is found by what it does, not by the noun it left.
function similarity(input: string, verb: string): number {
  if (verb.startsWith(input) || input.startsWith(verb)) {
    return prefixScore;
  }

  const inputWords = input.split(/\s+/);
  const verbWords = verb.split(/\s+/);
  const inputAction = inputWords[inputWords.length - 1];
  const verbAction = verbWords[verbWords.length - 1];

  return inputWords.reduce((score, word) => {
    // The action decides what a command does, so a one-letter slip on it (`generat`) still counts.
    // Two letters would make `slop` an action of `show`.
    if (word === inputAction && verbAction !== undefined && levenshtein(word, verbAction) <= 1) {
      return score + sameActionScore;
    }

    if (verbWords.includes(word)) {
      return score + sharedWordScore;
    }

    return verbWords.some((candidate) => levenshtein(word, candidate) <= nearWordDistance)
      ? score + nearWordScore
      : score;
  }, 0);
}

function levenshtein(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => i);

  for (let j = 1; j <= b.length; j += 1) {
    let previous = rows[0] ?? 0;
    rows[0] = j;

    for (let i = 1; i <= a.length; i += 1) {
      const current = rows[i] ?? 0;
      rows[i] = Math.min(
        current + 1,
        (rows[i - 1] ?? 0) + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = current;
    }
  }

  return rows[a.length] ?? 0;
}

function renderSuggestions(
  headline: string,
  suggestions: readonly string[],
  fallback: string,
): string {
  return [
    headline,
    ...suggestions.map((suggestion) => `  혹시 →  ${suggestion}`),
    `  ${suggestions.length > 0 ? '전체 목록' : '목록'} →  ${fallback}`,
  ].join('\n');
}

export function renderUnknownCommand(verb: string): string {
  return renderSuggestions(
    `알 수 없는 명령: ${verb}`,
    suggestVerbs(verb).map((suggestion) => `storyboard ${suggestion}`),
    'storyboard --help',
  );
}

// A flag typo is a letter or two off (`--titel`, `--dryrun`), so only near names are offered.
export function suggestFlags(name: string, limit = 2): string[] {
  const needle = name.toLowerCase();

  return flagCatalog
    .map((flag) => ({
      name: flag.name,
      distance: flag.name.startsWith(needle) ? 0 : levenshtein(needle, flag.name),
    }))
    .filter((entry) => entry.distance <= nearWordDistance)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map((entry) => entry.name);
}

export function renderUnknownFlag(name: string): string {
  return renderSuggestions(
    `알 수 없는 옵션: --${name}`,
    suggestFlags(name).map((suggestion) => `--${suggestion}`),
    'storyboard <명령> --help',
  );
}

export { flagCatalog };
