import {
  commandCatalog,
  commandGroups,
  findCommandSpec,
  findFlagSpec,
  flagCatalog,
  type CommandSpec,
} from './commands/catalog';

const usageColumn = 34;

function padUsage(usage: string): string {
  return usage.length >= usageColumn ? `${usage}  ` : usage.padEnd(usageColumn);
}

function renderCommandLine(spec: CommandSpec): string {
  return `  ${padUsage(spec.usage)}${spec.summary}`;
}

function renderFlagLine(name: string): string {
  const flag = findFlagSpec(name);

  if (!flag) {
    return `  --${name}`;
  }

  const label =
    flag.valueLabel === undefined ? `--${flag.name}` : `--${flag.name} ${flag.valueLabel}`;
  return `  ${padUsage(label)}${flag.summary}`;
}

// The first screen a new install sees, so the three commands that make the CLI usable come first.
export function renderGettingStarted(): string {
  return [
    '처음이라면',
    '  storyboard init --title "작품 이름"      빈 디렉터리를 워크스페이스로',
    '  storyboard setup                        AI 프로바이더와 키 설정 (익스텐션과 공유)',
    '  storyboard outline generate             작품 계약에서 시놉시스·챕터 계획',
    '  storyboard scene seeds                  챕터 계획에서 씬 시드',
    '  storyboard scene generate --all         초안 생성 (검수·수정 포함)',
    '  storyboard manuscript assemble          원고 조립',
    '',
    '  storyboard doctor 가 무엇이 빠졌는지 알려 줍니다.',
  ].join('\n');
}

export function renderUsage(version: string): string {
  const sections: string[] = [
    `storyboard ${version} — Storyboard 워크스페이스를 터미널에서`,
    '',
    '  storyboard <명령> [대상] [--옵션]',
    '  storyboard <명령> --help    한 명령의 옵션과 예시',
    '',
    renderGettingStarted(),
  ];

  for (const group of commandGroups) {
    const specs = commandCatalog.filter((spec) => spec.group === group);

    if (specs.length === 0) {
      continue;
    }

    sections.push('', group, ...specs.map(renderCommandLine));
  }

  sections.push(
    '',
    '공통 옵션',
    ...[
      'workspace',
      'provider',
      'model',
      'fallback',
      'json',
      'quiet',
      'verbose',
      'help',
      'version',
    ].map(renderFlagLine),
    '',
    '설정 파일  ~/.storyboard/config.json (공통) · <워크스페이스>/.storyboard/config.json (이 작품)',
    '키 파일    ~/.storyboard/secrets.json (0600)',
    '',
  );

  return sections.join('\n');
}

export function renderCommandHelp(verb: string): string | undefined {
  const spec = findCommandSpec(verb);

  if (!spec) {
    return undefined;
  }

  const lines = [`storyboard ${spec.usage}`, '', `  ${spec.summary}`];

  if (spec.flags && spec.flags.length > 0) {
    lines.push('', '옵션', ...spec.flags.map(renderFlagLine));
  }

  lines.push('', '공통 옵션', ...['workspace', 'json', 'quiet', 'verbose'].map(renderFlagLine));

  if (spec.examples && spec.examples.length > 0) {
    lines.push('', '예시', ...spec.examples.map((example) => `  ${example}`));
  }

  lines.push('');
  return lines.join('\n');
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

function similarity(input: string, verb: string): number {
  if (verb.startsWith(input) || input.startsWith(verb)) {
    return 3;
  }

  const inputWords = input.split(/\s+/);
  const verbWords = verb.split(/\s+/);
  const shared = inputWords.filter((word) => verbWords.includes(word)).length;

  if (shared > 0) {
    return 1 + shared;
  }

  return verbWords.some((word) => levenshtein(inputWords[0] ?? '', word) <= 2) ? 1 : 0;
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

export function renderUnknownCommand(verb: string): string {
  const suggestions = suggestVerbs(verb);
  const hint =
    suggestions.length > 0
      ? `이런 명령을 찾으셨나요?\n${suggestions.map((s) => `  storyboard ${s}`).join('\n')}\n`
      : '';

  return `알 수 없는 명령: ${verb}\n${hint}전체 목록: storyboard --help\n`;
}

export { flagCatalog };
