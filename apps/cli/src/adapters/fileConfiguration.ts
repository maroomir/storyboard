import { readFileSync } from 'node:fs';

import type { StoryboardConfigurationLike } from '@storyboard/story-ai';

function readJsonObject(file: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// Settings resolve workspace-first, then the user's home file, then the caller's default — the same
// precedence a VSCode workspace setting has over a user setting. Keys are the dotted
// `storyboard.*` names minus the prefix, so a config file reads like the settings UI.
function lookup(settings: Record<string, unknown>, section: string): unknown {
  if (section in settings) {
    return settings[section];
  }

  let current: unknown = settings;
  for (const part of section.split('.')) {
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
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

export function createFileConfiguration(
  userConfigFile: string,
  workspaceConfigFile: string,
  overrides: Readonly<Record<string, unknown>> = {},
): StoryboardConfigurationLike {
  // Flags win over the workspace file, which wins over the user file — the same precedence order
  // VSCode gives a workspace setting over a user setting, with the command line on top.
  // Flag overrides are leaves, never sections to merge into: `--provider` clearing task routing
  // must replace `tasks` outright, not deep-merge an empty object into what the file said.
  const merged = {
    ...mergeDeep(readJsonObject(userConfigFile), readJsonObject(workspaceConfigFile)),
    ...overrides,
  };

  return {
    get: <T>(section: string, defaultValue: T): T => {
      const value = lookup(merged, section);
      return value === undefined ? defaultValue : (value as T);
    },
  };
}
