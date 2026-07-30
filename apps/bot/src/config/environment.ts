import { accessSync, constants } from 'node:fs';
import { join } from 'node:path';

import type { ProvidersConfig } from './config';

export type CliProviderId = 'claude-code' | 'codex';

export interface CliProviderCommand {
  readonly providerId: CliProviderId;
  readonly command: string;
}

// Mirrors getDefaultCommand in @storyboard/story-ai's ConfigBridge: an unset `command` means the
// provider looks for this name on PATH.
const DEFAULT_CLI_COMMANDS: Record<CliProviderId, string> = {
  'claude-code': 'claude',
  codex: 'codex',
};

function isCliProviderId(providerId: string): providerId is CliProviderId {
  return providerId === 'claude-code' || providerId === 'codex';
}

// Every CLI provider this config can actually reach — the default plus anything a task pins — so
// diagnostics check only the commands that a generation would really invoke.
export function collectCliProviderCommands(
  providers: ProvidersConfig | undefined,
): CliProviderCommand[] {
  const providerIds = new Set<CliProviderId>();

  if (providers?.default !== undefined && isCliProviderId(providers.default)) {
    providerIds.add(providers.default);
  }
  for (const entry of Object.values(providers?.tasks ?? {})) {
    const providerId = typeof entry === 'string' ? entry : entry.provider;
    if (isCliProviderId(providerId)) {
      providerIds.add(providerId);
    }
  }

  return [...providerIds].map((providerId) => ({
    providerId,
    command: providers?.models?.[providerId]?.command ?? DEFAULT_CLI_COMMANDS[providerId],
  }));
}

function defaultIsExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function windowsExtensions(env: NodeJS.ProcessEnv): string[] {
  return (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((ext) => ext.length > 0);
}

// Resolves a command the way a shell would, without spawning anything: /doctor must stay a cheap
// read-only probe and must never execute a provider CLI just to see whether it exists.
export function findExecutableOnPath(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  isExecutable: (path: string) => boolean = defaultIsExecutable,
): string | undefined {
  if (command.includes('/') || command.includes('\\')) {
    return isExecutable(command) ? command : undefined;
  }

  const isWindows = process.platform === 'win32';
  const separator = isWindows ? ';' : ':';
  const candidateNames = isWindows
    ? [command, ...windowsExtensions(env).map((ext) => `${command}${ext}`)]
    : [command];

  for (const directory of (env.PATH ?? '').split(separator)) {
    if (directory.length === 0) {
      continue;
    }
    for (const name of candidateNames) {
      const candidate = join(directory, name);
      if (isExecutable(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}
