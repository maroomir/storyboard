import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { resolveStoryboardHomePaths } from '@storyboard/story-config';
import { createContext, useContext } from 'react';

export type TuiThemeName = 'default' | 'light' | 'mono';

export const tuiThemeNames: readonly TuiThemeName[] = ['default', 'light', 'mono'];

const defaultTuiThemeName: TuiThemeName = 'default';

export interface TuiTheme {
  readonly accent: string | undefined;
  readonly muted: string | undefined;
  readonly success: string | undefined;
  readonly warning: string | undefined;
  readonly danger: string | undefined;
}

export const tuiThemes: Readonly<Record<TuiThemeName, TuiTheme>> = {
  default: { accent: 'cyan', muted: 'gray', success: 'green', warning: 'yellow', danger: 'red' },
  light: { accent: 'blue', muted: 'gray', success: 'green', warning: 'magenta', danger: 'red' },
  mono: {
    accent: undefined,
    muted: 'gray',
    success: undefined,
    warning: undefined,
    danger: undefined,
  },
};

export const tuiThemeLabels: Readonly<Record<TuiThemeName, string>> = {
  default: '기본 (어두운 배경)',
  light: '밝은 배경',
  mono: '무채색',
};

export const TuiThemeContext: React.Context<TuiTheme> = createContext<TuiTheme>(tuiThemes.default);

export function useTuiTheme(): TuiTheme {
  return useContext(TuiThemeContext);
}

function tuiStateFile(): string {
  return join(resolveStoryboardHomePaths().home, 'tui.json');
}

function isThemeName(value: unknown): value is TuiThemeName {
  return tuiThemeNames.some((name) => name === value);
}

export function loadTuiThemeName(file: string = tuiStateFile()): TuiThemeName {
  if (!existsSync(file)) {
    return defaultTuiThemeName;
  }

  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const name: unknown = (parsed as { theme?: unknown }).theme;
    return isThemeName(name) ? name : defaultTuiThemeName;
  } catch {
    return defaultTuiThemeName;
  }
}

export function saveTuiThemeName(name: TuiThemeName, file: string = tuiStateFile()): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ theme: name }, null, 2)}\n`);
}
