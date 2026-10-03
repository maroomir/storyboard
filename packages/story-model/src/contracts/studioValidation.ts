import { parseJsonObject } from './aiResponseParser';

export type StudioValidationState = 'pass' | 'warn' | 'skipped';

export interface StudioValidationWarning {
  readonly message: string;
  readonly source?: string;
}

export interface StudioValidationVerdict {
  readonly state: StudioValidationState;
  readonly warnings: readonly StudioValidationWarning[];
}

export const skippedStudioValidation: StudioValidationVerdict = { state: 'skipped', warnings: [] };

const maxWarnings = 5;

// NOTE: an unreadable verdict must not block the author, so it degrades to 'skipped' rather than
// inventing a warning the model never made.
export function coerceStudioValidationVerdict(response: string): StudioValidationVerdict {
  const parsed = parseJsonObject(response);

  if (!parsed) {
    return skippedStudioValidation;
  }

  const warnings = (Array.isArray(parsed['warnings']) ? parsed['warnings'] : [])
    .map(toWarning)
    .filter((warning): warning is StudioValidationWarning => warning !== undefined)
    .slice(0, maxWarnings);

  if (warnings.length > 0) {
    return { state: 'warn', warnings };
  }

  return parsed['ok'] === false ? skippedStudioValidation : { state: 'pass', warnings: [] };
}

function toWarning(value: unknown): StudioValidationWarning | undefined {
  if (typeof value === 'string') {
    return value.trim().length > 0 ? { message: value.trim() } : undefined;
  }

  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as { readonly message?: unknown; readonly source?: unknown };

  if (typeof candidate.message !== 'string' || candidate.message.trim().length === 0) {
    return undefined;
  }

  const source = typeof candidate.source === 'string' ? candidate.source.trim() : '';

  return source.length > 0
    ? { message: candidate.message.trim(), source }
    : { message: candidate.message.trim() };
}
