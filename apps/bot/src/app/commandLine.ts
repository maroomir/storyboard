export type BotCommandLine =
  | { readonly kind: 'run' }
  | { readonly kind: 'setup' }
  | { readonly kind: 'doctor' }
  | { readonly kind: 'help' }
  | { readonly kind: 'version' }
  | { readonly kind: 'unknown'; readonly argument: string };

export const usageText = `사용법: storyboard-bot [명령]

명령:
  setup      대화형 설정 마법사 (~/.storyboard/bot.json 작성)
  doctor     설정·워크스페이스·프로바이더 점검
  (없음)     봇 실행

옵션:
  -h, --help     이 도움말
  -v, --version  버전

STORYBOARD_HOME 으로 설정 디렉터리를 옮길 수 있습니다.`;

// An unrecognized argument is refused rather than ignored: the bot used to start anyway, so a typo
// looked exactly like a configuration failure.
export function parseCommandLine(argv: readonly string[]): BotCommandLine {
  const [first, ...rest] = argv;

  if (first === undefined) {
    return { kind: 'run' };
  }

  const command = resolveCommand(first);
  if (command === undefined) {
    return { kind: 'unknown', argument: first };
  }

  const surplus = rest[0];
  return surplus === undefined ? command : { kind: 'unknown', argument: surplus };
}

function resolveCommand(argument: string): BotCommandLine | undefined {
  switch (argument) {
    case 'setup':
      return { kind: 'setup' };
    case 'doctor':
      return { kind: 'doctor' };
    case 'help':
    case '--help':
    case '-h':
      return { kind: 'help' };
    case '--version':
    case '-v':
      return { kind: 'version' };
    default:
      return undefined;
  }
}
