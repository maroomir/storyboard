import { existsSync, promises as fs } from 'node:fs';
import { join } from 'node:path';

import * as vscode from 'vscode';

import type { StoryboardRpcHandlers } from '@/presentation/messaging/bridge';
import type { StoryboardRequestPayload, StoryboardResponsePayload } from '@/shared/messaging';
import { restartStorygramAgent } from '@/infrastructure/storygram/storygramAgent';
import {
  applyBotConfigPatch,
  readBotConfigView,
  type BotConfigView,
} from '@/infrastructure/storygram/botConfigDocument';
import { resolveStorygramPaths } from '@/infrastructure/storygram/storygramConfigFile';
import { checkStorygramHealth } from '@/infrastructure/storygram/storygramHealth';
import { writeStorygramConfigFile } from '@/infrastructure/storygram/storygramSetup';

type BotConfigSnapshot = StoryboardResponsePayload<'bot.config.read'>;

export function createBotRpcHandlers(): StoryboardRpcHandlers {
  return {
    'bot.config.read': async (): Promise<BotConfigSnapshot> => buildSnapshot(),

    'bot.config.update': async (payload): Promise<BotConfigSnapshot> => updateConfig(payload),

    'bot.restart': async (): Promise<StoryboardResponsePayload<'bot.restart'>> => {
      const result = await restartStorygramAgent();
      return result.status === 'failed'
        ? { status: result.status, detail: result.detail }
        : { status: result.status };
    },
  };
}

async function readRawConfig(configFile: string): Promise<unknown | undefined> {
  let text: string;
  try {
    text = await fs.readFile(configFile, 'utf8');
  } catch {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function buildSnapshot(): Promise<BotConfigSnapshot> {
  const { configFile } = resolveStorygramPaths();
  const raw = await readRawConfig(configFile);
  const view = readBotConfigView(raw);
  const health = await checkStorygramHealth();

  return {
    configured: existsSync(configFile),
    configFile,
    ...toPayloadFields(view),
    workspaceCandidates: listWorkspaceCandidates(view.workspacePath),
    health: health.status,
  };
}

function toPayloadFields(
  view: BotConfigView,
): Omit<BotConfigSnapshot, 'configured' | 'configFile' | 'workspaceCandidates' | 'health'> {
  return {
    tokenHint: view.tokenHint,
    allowedChatIds: view.allowedChatIds,
    allowedUserIds: view.allowedUserIds,
    workspacePath: view.workspacePath,
    remote: view.remote,
    defaultProvider: view.defaultProvider,
    dashboardPort: view.dashboardPort,
  };
}

function listWorkspaceCandidates(
  connectedPath: string | null,
): BotConfigSnapshot['workspaceCandidates'] {
  return (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
    path: folder.uri.fsPath,
    hasProject: existsSync(join(folder.uri.fsPath, '.storyboard', 'project.json')),
    isConnected: folder.uri.fsPath === connectedPath,
  }));
}

async function updateConfig(
  payload: StoryboardRequestPayload<'bot.config.update'>,
): Promise<BotConfigSnapshot> {
  const paths = resolveStorygramPaths();
  const raw = await readRawConfig(paths.configFile);

  // Without an existing config there is no token, and this contract cannot supply one — sending the
  // user to the wizard is the only correct outcome.
  if (raw === undefined) {
    return buildSnapshot();
  }

  const next = applyBotConfigPatch(raw, payload);
  await writeStorygramConfigFile(paths.home, paths.configFile, next);

  return buildSnapshot();
}
