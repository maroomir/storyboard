import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { StoryboardConfigurationLike } from '@storyboard/story-ai';
import {
  hiddenProviderEnabledKey,
  hiddenProviderIds,
  type AiProviderId,
} from '@storyboard/story-model';

import { ConfigFileError } from '#config/configFileError';
import { validateConfigSettings, type ConfigKeyWarning } from '#config/configSchema';

// The numbers match VSCode's ConfigurationTarget so a ConfigBridge written against the editor's
// enum addresses the same layer here: 1 = the user's home file, 2 = the workspace file.
export const configurationTargets = { user: 1, workspace: 2 } as const;

export type ConfigurationTarget = (typeof configurationTargets)[keyof typeof configurationTargets];

export interface FileConfigurationOptions {
  readonly userConfigFile: string;
  readonly workspaceConfigFile?: string;
  // Flags win over the workspace file, which wins over the user file — the same precedence order
  // VSCode gives a workspace setting over a user setting, with the command line on top.
  // Flag overrides are leaves, never sections to merge into: `--provider` clearing task routing
  // must replace `tasks` outright, not deep-merge an empty object into what the file said.
  readonly overrides?: Readonly<Record<string, unknown>>;
  // An unreadable file throws by default so a typo cannot silently turn into "all defaults". A
  // host that must keep running (the editor) passes a reporter and gets `{}` for that file instead.
  readonly onInvalidFile?: (error: ConfigFileError) => void;
  // A key nothing reads is kept but reported once per file read, so a misspelled setting is seen
  // instead of silently leaving the default in force.
  readonly onUnknownKey?: (warning: ConfigKeyWarning) => void;
}

interface CachedFile {
  readonly key: string;
  readonly value: Record<string, unknown>;
}

function fileKey(file: string): string {
  try {
    const stats = statSync(file);
    return `${stats.mtimeMs}:${stats.size}`;
  } catch {
    return 'missing';
  }
}

function parseConfigFile(file: string): Record<string, unknown> {
  let raw: string;

  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ConfigFileError(
      'invalid-json',
      file,
      `설정 파일이 올바른 JSON이 아닙니다: ${file}`,
      error,
    );
  }

  if (!isPlainObject(parsed)) {
    throw new ConfigFileError(
      'not-an-object',
      file,
      `설정 파일의 최상위는 객체여야 합니다: ${file}`,
    );
  }

  return parsed;
}

// Keys are the dotted `storyboard.*` names minus the prefix, so a config file reads like the
// settings UI. A file may spell a key flat ("revise.loop.maxIterations") or nested; both resolve.
function lookup(settings: Record<string, unknown>, section: string): unknown {
  if (section in settings) {
    return settings[section];
  }

  let current: unknown = settings;
  for (const part of section.split('.')) {
    if (!isPlainObject(current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

// A shallow spread would let a workspace file that names one provider hide every provider the user
// file configured. Merge section by section so a workspace override replaces only the keys it names.
function mergeDeep(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(overlay)) {
    const existing = merged[key];
    merged[key] =
      isPlainObject(existing) && isPlainObject(value) ? mergeDeep(existing, value) : value;
  }

  return merged;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assignNested(settings: Record<string, unknown>, section: string, value: unknown): void {
  // A flat spelling of the same key would shadow the nested one on the next read.
  delete settings[section];

  const parts = section.split('.');
  const leaf = parts.pop() as string;
  const ancestors: Record<string, unknown>[] = [settings];
  let current = settings;

  for (const part of parts) {
    const next = current[part];

    if (!isPlainObject(next)) {
      if (value === undefined) {
        return;
      }

      current[part] = {};
    }

    current = current[part] as Record<string, unknown>;
    ancestors.push(current);
  }

  if (value !== undefined) {
    current[leaf] = value;
    return;
  }

  delete current[leaf];

  // Removing the last key of a section removes the section too, so a cleared setting does not
  // leave `{ "ai": { "provider": {} } }` behind in the file.
  for (let depth = parts.length; depth > 0; depth -= 1) {
    const parent = ancestors[depth - 1] as Record<string, unknown>;
    const child = ancestors[depth] as Record<string, unknown>;

    if (Object.keys(child).length > 0) {
      break;
    }

    delete parent[parts[depth - 1] as string];
  }
}

// Truncate-and-write loses the whole file if the process dies mid-write. Write a sibling and
// rename, so the file is either the old settings or the new ones.
function writeConfigFile(file: string, settings: Record<string, unknown>): void {
  const temporary = `${file}.tmp-${process.pid.toString(36)}`;

  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`);
    renameSync(temporary, file);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw new ConfigFileError('write-failed', file, `설정 파일을 쓸 수 없습니다: ${file}`, error);
  }
}

// SECURITY: only the user's home file may switch a hidden provider on; a workspace file is never
// asked. Hosts that list provider names before a configuration exists (argument checks, shell
// completion) read the same answer through this.
export function readEnabledHiddenProviderIds(userConfigFile: string): AiProviderId[] {
  let userSettings: Record<string, unknown>;

  try {
    userSettings = parseConfigFile(userConfigFile);
  } catch {
    // Whoever reads the file for its settings reports what is wrong with it.
    return [];
  }

  return hiddenProviderIds.filter(
    (providerId) => lookup(userSettings, hiddenProviderEnabledKey(providerId)) === true,
  );
}

export interface FileConfiguration extends StoryboardConfigurationLike {
  readonly inspect: NonNullable<StoryboardConfigurationLike['inspect']>;
  readonly update: NonNullable<StoryboardConfigurationLike['update']>;
  readonly targetFile: (target: ConfigurationTarget) => string | undefined;
}

export function createFileConfiguration(options: FileConfigurationOptions): FileConfiguration {
  const overrides = options.overrides ?? {};
  const cache = new Map<string, CachedFile>();
  let enabledHiddenProviders: { readonly key: string; readonly ids: AiProviderId[] } | undefined;

  function enabledHiddenProviderIds(): AiProviderId[] {
    const key = fileKey(options.userConfigFile);

    if (enabledHiddenProviders?.key === key) {
      return enabledHiddenProviders.ids;
    }

    const ids = readEnabledHiddenProviderIds(options.userConfigFile);
    enabledHiddenProviders = { key, ids };
    return ids;
  }

  function read(file: string | undefined): Record<string, unknown> {
    if (file === undefined) {
      return {};
    }

    const enabledHiddenIds = enabledHiddenProviderIds();
    const key = `${fileKey(file)}:${enabledHiddenIds.join(',')}`;
    const cached = cache.get(file);

    if (cached && cached.key === key) {
      return cached.value;
    }

    let value: Record<string, unknown>;

    try {
      value = parseConfigFile(file);
      for (const warning of validateConfigSettings(file, value, enabledHiddenIds)) {
        options.onUnknownKey?.(warning);
      }
    } catch (error) {
      if (!options.onInvalidFile || !(error instanceof ConfigFileError)) {
        throw error;
      }

      options.onInvalidFile(error);
      value = {};
    }

    cache.set(file, { key, value });
    return value;
  }

  function targetFile(target: ConfigurationTarget): string | undefined {
    return target === configurationTargets.workspace
      ? options.workspaceConfigFile
      : options.userConfigFile;
  }

  function merged(): Record<string, unknown> {
    return {
      ...mergeDeep(read(options.userConfigFile), read(options.workspaceConfigFile)),
      ...overrides,
    };
  }

  return {
    get: <T>(section: string, defaultValue: T): T => {
      const value = lookup(merged(), section);
      return value === undefined ? defaultValue : (value as T);
    },
    inspect: <T>(section: string) => ({
      globalValue: lookup(read(options.userConfigFile), section) as T | undefined,
      workspaceValue: lookup(read(options.workspaceConfigFile), section) as T | undefined,
    }),
    update: async <T>(
      section: string,
      value: T,
      target: number = configurationTargets.user,
    ): Promise<void> => {
      const file = targetFile(target as ConfigurationTarget);

      if (file === undefined) {
        throw new ConfigFileError(
          'write-failed',
          options.userConfigFile,
          '워크스페이스 설정 파일이 없어 이 작품에만 저장할 수 없습니다.',
        );
      }

      const settings = structuredClone(parseConfigFile(file));
      assignNested(settings, section, value);
      writeConfigFile(file, settings);
      cache.delete(file);
    },
    targetFile,
  };
}
