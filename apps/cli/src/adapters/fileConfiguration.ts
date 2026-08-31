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

export function createFileConfiguration(
  userConfigFile: string,
  workspaceConfigFile: string,
  overrides: Readonly<Record<string, unknown>> = {},
): StoryboardConfigurationLike {
  // Flags win over the workspace file, which wins over the user file — the same precedence order
  // VSCode gives a workspace setting over a user setting, with the command line on top.
  const merged = {
    ...readJsonObject(userConfigFile),
    ...readJsonObject(workspaceConfigFile),
    ...overrides,
  };

  return {
    get: <T>(section: string, defaultValue: T): T => {
      const value = lookup(merged, section);
      return value === undefined ? defaultValue : (value as T);
    },
  };
}
