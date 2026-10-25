import { render, type Instance } from 'ink';

import { StoryboardTui } from './app';
import { loadTuiThemeName } from './tuiTheme';
import { describeHeader, readWorkspaceView, type TuiHeaderInfo } from './workspaceView';
import type { TuiSessionOptions } from '@/tui/session';

export { describeHeader };

export async function runTui(options: TuiSessionOptions): Promise<number> {
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    process.stderr.write(
      '대화형 화면은 터미널에서만 열립니다. 파이프나 에이전트에서는 `storyboard <명령>` 을 그대로 쓰세요.\n',
    );
    return 1;
  }

  const header: TuiHeaderInfo = describeHeader(options.cwd);
  const instance: Instance = render(
    <StoryboardTui
      version={options.version}
      cwd={options.cwd}
      header={header}
      loadWorkspaceView={() => readWorkspaceView(options.cwd, options.version)}
      themeName={loadTuiThemeName()}
    />,
    { exitOnCtrlC: false },
  );

  await instance.waitUntilExit();
  return 0;
}
