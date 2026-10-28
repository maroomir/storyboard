import { completionShells, type CommandSpec } from '@/commands/catalog';

export const dispatcherVerbSpecs: readonly CommandSpec[] = [
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
];
