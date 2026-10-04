// 색은 역할로만 고른다. 부르는 쪽은 «강조»나 «경고»를 말하고, 그것이 어떤 SGR 코드인지는 이
// 파일만 안다. 테마를 바꾸는 일이 이 표 하나를 바꾸는 일이 되도록.

export type ThemeRole = 'accent' | 'muted' | 'heading' | 'success' | 'warning' | 'danger';

export interface Theme {
  readonly isColorEnabled: boolean;
  readonly paint: (role: ThemeRole, text: string) => string;
}

// Each role closes with its own reset (39 for color, 22 for weight) rather than a full reset, so a
// painted word inside a painted line does not cut the outer style short.
const roleCodes: Readonly<Record<ThemeRole, readonly [open: number, close: number]>> = {
  accent: [36, 39],
  muted: [90, 39],
  heading: [1, 22],
  success: [32, 39],
  warning: [33, 39],
  danger: [31, 39],
};

export function createTheme(isColorEnabled: boolean): Theme {
  return {
    isColorEnabled,
    paint: (role, text) => {
      if (!isColorEnabled || text.length === 0) {
        return text;
      }

      const [open, close] = roleCodes[role];
      return `\u001b[${open}m${text}\u001b[${close}m`;
    },
  };
}

export const plainTheme = createTheme(false);

export interface ColorConditions {
  readonly isTty: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly hasNoColorFlag: boolean;
  readonly isJsonOutput: boolean;
}

// Color is for a person at a terminal. A pipe, an agent reading `--json`, `NO_COLOR`
// (https://no-color.org) or a dumb terminal all get the same bytes they got before color existed.
export function shouldUseColor(conditions: ColorConditions): boolean {
  if (!conditions.isTty || conditions.hasNoColorFlag || conditions.isJsonOutput) {
    return false;
  }

  const noColor = conditions.env.NO_COLOR;
  return (noColor === undefined || noColor.length === 0) && conditions.env.TERM !== 'dumb';
}
