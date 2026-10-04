import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { resolveStoryboardHomePaths } from '@storyboard/story-config';
import { createContext, useContext } from 'react';

// 대화형 화면의 색. 컴포넌트는 역할(강조·흐림·경고·…)만 말하고, 어느 색인지는 고른 테마가 정한다.

export const tuiThemeNames = ['default', 'light', 'mono'] as const;

export type TuiThemeName = (typeof tuiThemeNames)[number];

// An undefined color is the terminal's own foreground, which is what «mono» asks for.
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

export const TuiThemeContext = createContext<TuiTheme>(tuiThemes.default);

export function useTuiTheme(): TuiTheme {
  return useContext(TuiThemeContext);
}

// NOTE: 대화형 화면만 쓰는 상태라 config.json 이 아니라 ~/.storyboard/tui.json 에 둔다.
function tuiStateFile(): string {
  return join(resolveStoryboardHomePaths().home, 'tui.json');
}

function isThemeName(value: unknown): value is TuiThemeName {
  return tuiThemeNames.some((name) => name === value);
}

export function loadTuiThemeName(file: string = tuiStateFile()): TuiThemeName {
  if (!existsSync(file)) {
    return 'default';
  }

  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const name = (parsed as { theme?: unknown }).theme;
    return isThemeName(name) ? name : 'default';
  } catch {
    // A damaged preference file costs the author their color choice, not the screen.
    return 'default';
  }
}

export function saveTuiThemeName(name: TuiThemeName, file: string = tuiStateFile()): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ theme: name }, null, 2)}\n`);
}
