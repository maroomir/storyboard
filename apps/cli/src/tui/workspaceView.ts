import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';

import { ConfigBridge } from '@storyboard/story-ai';
import {
  createFileConfiguration,
  resolveStoryboardHomePaths,
  resolveWorkspaceConfigFile,
} from '@storyboard/story-config';
import type { WorkspaceStatus } from '@storyboard/story-app';
import type { IStoryboardLogger } from '@storyboard/story-engine';
import { STORYBOARD_RELATIVE_PATHS } from '@storyboard/story-model';

import { createCliContainer } from '@/container';

export interface TuiHeaderInfo {
  readonly workspaceLabel: string;
  readonly providerLabel: string;
  readonly hint?: string;
}

// What the screen shows around the prompt. It is read again after every command, since a command
// (or another app) may have changed it.
export interface WorkspaceView {
  readonly header: TuiHeaderInfo;
  // Another app writing this workspace right now, phrased for the author.
  readonly lockHolder?: string;
  // Absent outside a workspace, or when the workspace cannot be read; the prompt still works then.
  readonly status?: WorkspaceStatus;
}

const silentLogger: IStoryboardLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  show: () => undefined,
};

function isWorkspace(cwd: string): boolean {
  return existsSync(join(cwd, STORYBOARD_RELATIVE_PATHS.projectJson));
}

// The header answers the two questions a person has before typing anything: where am I, and
// which AI will answer. Both come from the same files the one-shot commands read.
export function describeHeader(cwd: string): TuiHeaderInfo {
  const isWorkspaceFolder = isWorkspace(cwd);
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
    workspaceLabel: isWorkspaceFolder ? basename(cwd) : `${basename(cwd)} (워크스페이스 아님)`,
    providerLabel,
    ...(isWorkspaceFolder
      ? {}
      : { hint: '아직 워크스페이스가 아닙니다: init --title "작품 이름"' }),
    ...(configBridge.isDefaultProviderConfigured()
      ? {}
      : { hint: '프로바이더가 없습니다: /setup 또는 setup --provider <id>' }),
  };
}

export async function readWorkspaceView(cwd: string, version: string): Promise<WorkspaceView> {
  const header = describeHeader(cwd);

  if (!isWorkspace(cwd)) {
    return { header };
  }

  const container = createCliContainer({
    workspacePath: cwd,
    logger: silentLogger,
    canPrompt: false,
    version,
  });
  const lockHolder = await container.runGate.describeHolder(container.workspaceRoot);
  const status = await readStatus(container);

  return {
    header,
    ...(lockHolder === undefined ? {} : { lockHolder }),
    ...(status === undefined ? {} : { status }),
  };
}

async function readStatus(
  container: ReturnType<typeof createCliContainer>,
): Promise<WorkspaceStatus | undefined> {
  try {
    return await container.describeWorkspace();
  } catch {
    // A damaged project file must not take the prompt down with it; `doctor` at the prompt names it.
    return undefined;
  }
}
