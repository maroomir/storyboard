import { parseJsonObject } from './aiResponseParser';

type UntypedFields = Readonly<Record<string, unknown>>;

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

const maxWarnings: number = 5;

export function coerceStudioValidationVerdict(response: string): StudioValidationVerdict {
  const parsed: Record<string, unknown> | null = parseJsonObject(response);

  if (!parsed) {
    return skippedStudioValidation;
  }

  const warnings: StudioValidationWarning[] = (
    Array.isArray(parsed['warnings']) ? parsed['warnings'] : []
  )
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

  const candidate: UntypedFields = value as UntypedFields;

  if (typeof candidate.message !== 'string' || candidate.message.trim().length === 0) {
    return undefined;
  }

  const source: string = typeof candidate.source === 'string' ? candidate.source.trim() : '';

  return source.length > 0
    ? { message: candidate.message.trim(), source }
    : { message: candidate.message.trim() };
}
