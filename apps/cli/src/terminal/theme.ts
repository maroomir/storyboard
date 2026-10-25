export type ThemeRole = 'accent' | 'muted' | 'heading' | 'success' | 'warning' | 'danger';

export interface Theme {
  readonly isColorEnabled: boolean;
  readonly paint: (role: ThemeRole, text: string) => string;
}

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
    paint: (role, text): string => {
      if (!isColorEnabled || text.length === 0) {
        return text;
      }

      const [open, close] = roleCodes[role];
      return `\u001b[${open}m${text}\u001b[${close}m`;
    },
  };
}

export const plainTheme: Theme = createTheme(false);

export interface ColorConditions {
  readonly isTty: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly hasNoColorFlag: boolean;
  readonly isJsonOutput: boolean;
}

export function shouldUseColor(conditions: ColorConditions): boolean {
  if (!conditions.isTty || conditions.hasNoColorFlag || conditions.isJsonOutput) {
    return false;
  }

  const noColor: string | undefined = conditions.env.NO_COLOR;
  return (noColor === undefined || noColor.length === 0) && conditions.env.TERM !== 'dumb';
}
