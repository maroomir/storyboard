import { parseJsonObject } from './aiResponseParser';

export type StudioAgentEntityKind = 'character' | 'background' | 'scene';

export interface StudioAgentLookupRequest {
  readonly kind: StudioAgentEntityKind | 'draft';
  readonly key: string;
}

export interface StudioCardFieldChange {
  readonly field: string;
  readonly value: string | readonly string[];
}

export interface StudioDraftReplacement {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly newText: string;
}

export type StudioPatch =
  | { readonly target: 'card'; readonly changes: readonly StudioCardFieldChange[] }
  | { readonly target: 'draft'; readonly replacements: readonly StudioDraftReplacement[] };

export type StudioAgentAction =
  | { readonly kind: 'say'; readonly message: string }
  | {
      readonly kind: 'ask';
      readonly question: string;
      readonly options: readonly string[];
    }
  | {
      readonly kind: 'lookup';
      readonly requests: readonly StudioAgentLookupRequest[];
      readonly reason?: string;
    }
  | {
      readonly kind: 'propose';
      readonly summary: string;
      readonly message?: string;
      readonly patch: StudioPatch;
    };

const maxAskOptions = 4;
const maxLookupRequests = 4;

export function coerceStudioAgentAction(response: string): StudioAgentAction | undefined {
  const parsed = parseJsonObject(response);

  if (!parsed) {
    return undefined;
  }

  switch (parsed['kind']) {
    case 'say':
      return coerceSay(parsed);
    case 'ask':
      return coerceAsk(parsed);
    case 'lookup':
      return coerceLookup(parsed);
    case 'propose':
      return coercePropose(parsed);
    default:
      return undefined;
  }
}

function coerceSay(parsed: Record<string, unknown>): StudioAgentAction | undefined {
  const message = trimmedString(parsed['message']);

  return message ? { kind: 'say', message } : undefined;
}

function coerceAsk(parsed: Record<string, unknown>): StudioAgentAction | undefined {
  const question = trimmedString(parsed['question']);

  if (!question) {
    return undefined;
  }

  return { kind: 'ask', question, options: stringList(parsed['options']).slice(0, maxAskOptions) };
}

function coerceLookup(parsed: Record<string, unknown>): StudioAgentAction | undefined {
  const rawRequests = Array.isArray(parsed['requests']) ? parsed['requests'] : [];

  const requests = rawRequests
    .map(toLookupRequest)
    .filter((request): request is StudioAgentLookupRequest => request !== undefined)
    .slice(0, maxLookupRequests);

  if (requests.length === 0) {
    return undefined;
  }

  const reason = trimmedString(parsed['reason']);

  return reason ? { kind: 'lookup', requests, reason } : { kind: 'lookup', requests };
}

function toLookupRequest(value: unknown): StudioAgentLookupRequest | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as { readonly kind?: unknown; readonly key?: unknown };
  const key = trimmedString(candidate.key);

  if (!key || !isLookupKind(candidate.kind)) {
    return undefined;
  }

  return { kind: candidate.kind, key };
}

function isLookupKind(value: unknown): value is StudioAgentLookupRequest['kind'] {
  return value === 'character' || value === 'background' || value === 'scene' || value === 'draft';
}

function coercePropose(parsed: Record<string, unknown>): StudioAgentAction | undefined {
  const summary = trimmedString(parsed['summary']);
  const patch = toPatch(parsed['patch']);

  if (!summary || !patch) {
    return undefined;
  }

  const message = trimmedString(parsed['message']);

  return message
    ? { kind: 'propose', summary, message, patch }
    : { kind: 'propose', summary, patch };
}

function toPatch(value: unknown): StudioPatch | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as {
    readonly target?: unknown;
    readonly changes?: unknown;
    readonly replacements?: unknown;
  };

  if (candidate.target === 'card') {
    const changes = (Array.isArray(candidate.changes) ? candidate.changes : [])
      .map(toCardFieldChange)
      .filter((change): change is StudioCardFieldChange => change !== undefined);

    return changes.length > 0 ? { target: 'card', changes } : undefined;
  }

  if (candidate.target === 'draft') {
    const replacements = (Array.isArray(candidate.replacements) ? candidate.replacements : [])
      .map(toDraftReplacement)
      .filter((replacement): replacement is StudioDraftReplacement => replacement !== undefined);

    return replacements.length > 0 ? { target: 'draft', replacements } : undefined;
  }

  return undefined;
}

function toCardFieldChange(value: unknown): StudioCardFieldChange | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as { readonly field?: unknown; readonly value?: unknown };
  const field = trimmedString(candidate.field);

  if (!field) {
    return undefined;
  }

  if (typeof candidate.value === 'string') {
    return { field, value: candidate.value };
  }

  return Array.isArray(candidate.value)
    ? { field, value: stringList(candidate.value) }
    : undefined;
}

function toDraftReplacement(value: unknown): StudioDraftReplacement | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as {
    readonly startOffset?: unknown;
    readonly endOffset?: unknown;
    readonly newText?: unknown;
  };

  if (
    !isNonNegativeInteger(candidate.startOffset) ||
    !isNonNegativeInteger(candidate.endOffset) ||
    typeof candidate.newText !== 'string' ||
    candidate.endOffset < candidate.startOffset
  ) {
    return undefined;
  }

  return {
    startOffset: candidate.startOffset,
    endOffset: candidate.endOffset,
    newText: candidate.newText,
  };
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function trimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
}
