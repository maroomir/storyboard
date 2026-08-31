import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { flagBoolean, flagString, parseArguments } from './cliArguments';
import { commands, type CommandOutcome } from './commands/index';
import { createCliContainer } from './container';

const version = '0.7.3';

const usage = `storyboard ${version} — Storyboard workspaces from the command line

  storyboard <noun> <verb> [target] [flags]

Commands
  scene generate <stem>        씬 초안을 생성합니다 (--all 로 전체, --force 로 재생성)
  scene revise <stem>          기존 초안을 검수하고 재작성합니다
  scene draft <stem>           초안 파일 경로를 출력합니다
  outline generate             시놉시스와 챕터 계획을 만듭니다 (--force 로 덮어쓰기)
  novel generate               기획부터 원고 조립까지 한 번에 돌립니다
  manuscript assemble          draft/ 를 원고로 조립합니다
  manuscript review            조립 원고를 검사합니다
  manuscript summaries         장별 요약을 만듭니다

Flags
  --workspace <path>           대상 워크스페이스 (기본: 현재 디렉터리)
  --json                       결과를 JSON 으로 stdout 에 출력합니다
  --verbose                    진행 로그를 stderr 에 출력합니다
  --version, --help
`;

async function main(argv: readonly string[]): Promise<number> {
  const args = parseArguments(argv);

  if (flagBoolean(args.flags, 'version')) {
    process.stdout.write(`${version}\n`);
    return 0;
  }

  if (args.path.length === 0 || flagBoolean(args.flags, 'help')) {
    process.stdout.write(usage);
    return args.path.length === 0 ? 1 : 0;
  }

  const verb = args.path.join(' ');
  const handler = commands[verb];

  if (!handler) {
    process.stderr.write(`알 수 없는 명령: ${verb}\n\n${usage}`);
    return 1;
  }

  const workspacePath = resolve(flagString(args.flags, 'workspace') ?? process.cwd());

  if (!existsSync(join(workspacePath, '.storyboard', 'project.json'))) {
    process.stderr.write(
      `Storyboard 워크스페이스가 아닙니다: ${workspacePath}\n` +
        '.storyboard/project.json 이 있는 디렉터리에서 실행하거나 --workspace 로 지정해 주세요.\n',
    );
    return 1;
  }

  const container = createCliContainer({
    workspacePath,
    verbose: flagBoolean(args.flags, 'verbose'),
    version,
  });

  const outcome = await handler({ container, args });
  report(outcome, flagBoolean(args.flags, 'json'));
  return outcome.ok ? 0 : 1;
}

// NOTE: stdout carries the result and nothing else, so an agent can pipe `--json` straight into a
// parser while progress and warnings go to stderr.
function report(outcome: CommandOutcome, asJson: boolean): void {
  if (asJson) {
    process.stdout.write(
      `${JSON.stringify({ ok: outcome.ok, message: outcome.message, data: outcome.data ?? null })}\n`,
    );
    return;
  }

  process.stdout.write(`${outcome.message}\n`);
}

void main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`[error] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
