import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';

import { render } from 'ink';

import { ConfigBridge } from '@storyboard/story-ai';
import {
  createFileConfiguration,
  resolveStoryboardHomePaths,
  resolveWorkspaceConfigFile,
} from '@storyboard/story-config';

import { StoryboardTui, type TuiHeaderInfo } from './app';
import { STORYBOARD_RELATIVE_PATHS } from '@storyboard/story-model';

export interface RunTuiOptions {
  readonly version: string;
  readonly cwd: string;
}

// The header answers the two questions a person has before typing anything: where am I, and
// which AI will answer. Both come from the same files the one-shot commands read.
export function describeHeader(cwd: string): TuiHeaderInfo {
  const isWorkspace = existsSync(join(cwd, STORYBOARD_RELATIVE_PATHS.projectJson));
  const home = resolveStoryboardHomePaths();
  const configBridge = new ConfigBridge({
    getConfiguration: () =>
      createFileConfiguration({
        userConfigFile: home.configFile,
        workspaceConfigFile: resolveWorkspaceConfigFile(cwd),
        onInvalidFile: () => undefined,
      }),
  });

  const providerLabel = configBridge.isDefaultProviderConfigured()
    ? `${configBridge.getDefaultProvider()} · ${configBridge.getProviderConfig(configBridge.getDefaultProvider()).model ?? ''}`.replace(
        / · $/,
        '',
      )
    : 'AI 프로바이더 없음';

  return {
    workspaceLabel: isWorkspace ? basename(cwd) : `${basename(cwd)} (워크스페이스 아님)`,
    providerLabel,
    ...(isWorkspace ? {} : { hint: '아직 워크스페이스가 아닙니다: init --title "작품 이름"' }),
    ...(configBridge.isDefaultProviderConfigured()
      ? {}
      : { hint: '프로바이더가 없습니다: /setup 또는 setup --provider <id>' }),
  };
}

export async function runTui(options: RunTuiOptions): Promise<number> {
  if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    process.stderr.write(
      '대화형 화면은 터미널에서만 열립니다. 파이프나 에이전트에서는 `storyboard <명령>` 을 그대로 쓰세요.\n',
    );
    return 1;
  }

  const header = describeHeader(options.cwd);
  const instance = render(
    <StoryboardTui version={options.version} cwd={options.cwd} header={header} />,
    { exitOnCtrlC: false },
  );

  await instance.waitUntilExit();
  return 0;
}
