import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import { dirname } from 'node:path';

import type { StoryboardConfigurationLike } from '@storyboard/story-ai';
import {
  hiddenProviderEnabledKey,
  hiddenProviderIds,
  type AiProviderId,
} from '@storyboard/story-model';

import { ConfigFileError } from '#config/configFileError';
import { validateConfigSettings, type ConfigKeyWarning } from '#config/configSchema';

interface ConfigurationTargets {
  readonly user: 1;
  readonly workspace: 2;
}

export const configurationTargets: ConfigurationTargets = { user: 1, workspace: 2 };

export type ConfigurationTarget = ConfigurationTargets[keyof ConfigurationTargets];

export interface FileConfigurationOptions {
  readonly userConfigFile: string;
  readonly workspaceConfigFile?: string;
  readonly overrides?: Readonly<Record<string, unknown>>;
  readonly onInvalidFile?: (error: ConfigFileError) => void;
  readonly onUnknownKey?: (warning: ConfigKeyWarning) => void;
}

interface CachedFile {
  readonly key: string;
  readonly value: Record<string, unknown>;
}

function fileKey(file: string): string {
  try {
    const stats: Stats = statSync(file);
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

function mergeDeep(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(overlay)) {
    const existing: unknown = merged[key];
    merged[key] =
      isPlainObject(existing) && isPlainObject(value) ? mergeDeep(existing, value) : value;
  }

  return merged;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assignNested(settings: Record<string, unknown>, section: string, value: unknown): void {
  delete settings[section];

  const parts: string[] = section.split('.');
  const leaf: string = parts.pop() as string;
  const ancestors: Record<string, unknown>[] = [settings];
  let current: Record<string, unknown> = settings;

  for (const part of parts) {
    const next: unknown = current[part];

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

  for (let depth: number = parts.length; depth > 0; depth -= 1) {
    const parent: Record<string, unknown> = ancestors[depth - 1] as Record<string, unknown>;
    const child: Record<string, unknown> = ancestors[depth] as Record<string, unknown>;

    if (Object.keys(child).length > 0) {
      break;
    }

    delete parent[parts[depth - 1] as string];
  }
}

function writeConfigFile(file: string, settings: Record<string, unknown>): void {
  const temporary: string = `${file}.tmp-${process.pid.toString(36)}`;

  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`);
    renameSync(temporary, file);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw new ConfigFileError('write-failed', file, `설정 파일을 쓸 수 없습니다: ${file}`, error);
  }
}

export function readEnabledHiddenProviderIds(userConfigFile: string): AiProviderId[] {
  let userSettings: Record<string, unknown>;

  try {
    userSettings = parseConfigFile(userConfigFile);
  } catch {
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
  const overrides: Readonly<Record<string, unknown>> = options.overrides ?? {};
  const cache: Map<string, CachedFile> = new Map<string, CachedFile>();
  let enabledHiddenProviders: { readonly key: string; readonly ids: AiProviderId[] } | undefined;

  function enabledHiddenProviderIds(): AiProviderId[] {
    const key: string = fileKey(options.userConfigFile);

    if (enabledHiddenProviders?.key === key) {
      return enabledHiddenProviders.ids;
    }

    const ids: AiProviderId[] = readEnabledHiddenProviderIds(options.userConfigFile);
    enabledHiddenProviders = { key, ids };
    return ids;
  }

  function read(file: string | undefined): Record<string, unknown> {
    if (file === undefined) {
      return {};
    }

    const enabledHiddenIds: AiProviderId[] = enabledHiddenProviderIds();
    const key: string = `${fileKey(file)}:${enabledHiddenIds.join(',')}`;
    const cached: CachedFile | undefined = cache.get(file);

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
      const value: unknown = lookup(merged(), section);
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
      const file: string | undefined = targetFile(target as ConfigurationTarget);

      if (file === undefined) {
        throw new ConfigFileError(
          'write-failed',
          options.userConfigFile,
          '워크스페이스 설정 파일이 없어 이 작품에만 저장할 수 없습니다.',
        );
      }

      const settings: Record<string, unknown> = structuredClone(parseConfigFile(file));
      assignNested(settings, section, value);
      writeConfigFile(file, settings);
      cache.delete(file);
    },
    targetFile,
  };
}
