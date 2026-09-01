import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { aiProviderIds, storyboardModelCatalog, type AiProviderId } from '@storyboard/story-ai';

import {
  flagBoolean,
  flagString,
  isParseFailure,
  parseArguments,
  resolveVerb,
} from './cliArguments';
import { commands, type CommandOutcome } from './commands/index';
import { createCliContainer } from './container';

const version = '0.7.3';

const usage = `storyboard ${version} — Storyboard workspaces from the command line

  storyboard <noun> <verb> [target] [flags]

Commands
  scene generate <stem>        씬 초안을 생성합니다 (--force 로 재생성)
  scene generate --all         초안이 없거나 입력이 바뀐 씬만 생성합니다 (--force 미지원)
  scene revise <stem>          기존 초안을 검수하고 재작성합니다
  scene draft <stem>           초안 파일 경로를 출력합니다
  init --title <name>          현재 디렉터리를 Storyboard 워크스페이스로 만듭니다
  draft format <stem>          초안을 프로젝트 형식으로 다시 씁니다
  draft augment <stem>         갱신된 카드·정전을 기존 초안에 녹입니다 (--dry-run)
  manuscript export            조립 원고를 stdout 또는 --out 파일로 냅니다
  check grammar <stem>         초안의 문법을 검사합니다
  check continuity <stem>      정전과 어긋나는 곳을 검사합니다
  check slop <stem>            상투 표현을 검사합니다 (AI 호출 없음)
  scene seeds                  아웃라인에서 씬 시드를 만듭니다 (--force 로 덮어쓰기)
  scene complete               끝번호 뒤에 붙일 완결 씬을 제안합니다 (읽기 전용)
  cards build                  씬만 읽어 카드 구성안을 만듭니다 (읽기 전용)
  canon diff                   정전에 아직 없는 설정 후보를 보고합니다 (읽기 전용)
  card create <kind> --name    빈 인물/배경 카드를 만듭니다
  scene create --name          다음 번호로 씬 카드를 만듭니다
  card recommend <kind>        카드가 없는 인물/배경을 찾습니다 (읽기 전용)
  card promote                 초안에서 추출한 카드 후보를 반영합니다 (--dry-run)
  bible promote                초안에서 추출한 설정 후보를 정전에 반영합니다 (--dry-run)
  apikey set <provider>        API 키를 stdin 으로 받아 저장합니다 (빈 입력이면 삭제)
  outline generate             시놉시스와 챕터 계획을 만듭니다 (--force 로 덮어쓰기)
  novel generate               기획부터 원고 조립까지 한 번에 돌립니다
  manuscript assemble          draft/ 를 원고로 조립합니다
  manuscript review            조립 원고를 검사합니다
  manuscript summaries         장별 요약을 만듭니다

Flags
  --workspace <path>           대상 워크스페이스 (기본: 현재 디렉터리)
  --provider <id>              이번 실행에만 쓸 프로바이더 (codex, claude-code, mock …)
  --model <name>               그 프로바이더의 모델
  --revise-iterations <n>      검수-재작성 반복 상한 (1-5)
  --no-revise                  생성 뒤 검수-재작성을 건너뜁니다
  --out <path>                 manuscript export 의 출력 파일
  --instruction <text>         draft augment 에 줄 추가 지시
  --name <text>                card/scene create 가 쓸 이름
  --id <slug>                  card create 의 파일명 (기본: 이름에서 유도)
  --title <name>               init 이 만들 작품 이름
  --language <code>            init 의 언어 (기본 ko)
  --dry-run                    반영하지 않고 대상만 보고합니다
  --json                       결과를 JSON 으로 stdout 에 출력합니다
  --verbose                    진행 로그를 stderr 에 출력합니다
  --version, --help
`;

async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArguments(argv);

  if (isParseFailure(parsed)) {
    process.stderr.write(`${parsed.message}\n\n${usage}`);
    return 1;
  }

  const args = resolveVerb(parsed, Object.keys(commands));

  if (flagBoolean(args.flags, 'version')) {
    process.stdout.write(`${version}\n`);
    return 0;
  }

  if (flagBoolean(args.flags, 'help')) {
    process.stdout.write(usage);
    return 0;
  }

  if (args.path.length === 0) {
    process.stderr.write(usage);
    return 1;
  }

  const verb = args.path.join(' ');
  const handler = commands[verb];

  if (!handler) {
    process.stderr.write(`알 수 없는 명령: ${verb}\n\n${usage}`);
    return 1;
  }

  const providerFailure = validateProvider(
    flagString(args.flags, 'provider'),
    flagString(args.flags, 'model'),
  );

  if (providerFailure !== undefined) {
    process.stderr.write(`${providerFailure}\n`);
    return 1;
  }

  const workspacePath = resolve(flagString(args.flags, 'workspace') ?? process.cwd());

  // `init` creates the workspace and `apikey set` is machine-wide, so neither can require one to
  // already exist — demanding it would make the CLI unusable from an empty directory.
  const needsWorkspace = verb !== 'apikey set' && verb !== 'init';

  if (needsWorkspace && !existsSync(join(workspacePath, '.storyboard', 'project.json'))) {
    process.stderr.write(
      `Storyboard 워크스페이스가 아닙니다: ${workspacePath}\n` +
        '.storyboard/project.json 이 있는 디렉터리에서 실행하거나 --workspace 로 지정해 주세요.\n',
    );
    return 1;
  }

  const reviseIterations = flagString(args.flags, 'revise-iterations');
  const container = createCliContainer({
    workspacePath,
    verbose: flagBoolean(args.flags, 'verbose'),
    version,
    ...(flagString(args.flags, 'provider') === undefined
      ? {}
      : { provider: flagString(args.flags, 'provider') }),
    ...(flagString(args.flags, 'model') === undefined
      ? {}
      : { model: flagString(args.flags, 'model') }),
    ...(reviseIterations === undefined ? {} : { reviseMaxIterations: Number(reviseIterations) }),
  });

  const outcome = await handler({ container, args });
  report(outcome, flagBoolean(args.flags, 'json'));
  return outcome.ok ? 0 : 1;
}

// SECURITY-adjacent: an unknown provider used to fall back to `mock`, which always succeeds — a
// typo would overwrite a real draft with synthetic text and still exit 0. Refuse instead: an
// unattended run has nobody to notice.
function validateProvider(
  provider: string | undefined,
  model: string | undefined,
): string | undefined {
  if (provider === undefined) {
    return model === undefined
      ? undefined
      : '--model 은 --provider 와 함께 써야 합니다. 어느 프로바이더의 모델인지 알 수 없습니다.';
  }

  if (!aiProviderIds.includes(provider as AiProviderId)) {
    return `알 수 없는 프로바이더: ${provider}\n쓸 수 있는 값: ${aiProviderIds.join(', ')}`;
  }

  const catalog = storyboardModelCatalog[provider as AiProviderId];

  if (model !== undefined && !catalog.some((entry) => entry.id === model)) {
    return (
      `${provider} 에 없는 모델: ${model}\n` +
      `쓸 수 있는 값: ${catalog.map((entry) => entry.id).join(', ')}`
    );
  }

  return undefined;
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
