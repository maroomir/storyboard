import { coerceOptionalString, coerceStringList } from '#model/format/unknownValues';
import { parseJsonObject } from './aiResponseParser';

type UntypedFields = Readonly<Record<string, unknown>>;

export type StudioAgentEntityKind = 'character' | 'background' | 'scene';

export interface StudioAgentLookupRequest {
  readonly kind: StudioAgentEntityKind | 'draft';
  readonly key: string;
}

export type StudioAgentToolName =
  | 'continuityCheck'
  | 'grammarCheck'
  | 'expand'
  | 'condense'
  | 'augment'
  | 'collectFromDrafts'
  | 'cardAudit'
  | 'relationCheck';

export const studioAgentToolNames: readonly [StudioAgentToolName, ...StudioAgentToolName[]] = [
  'continuityCheck',
  'grammarCheck',
  'expand',
  'condense',
  'augment',
  'collectFromDrafts',
  'cardAudit',
  'relationCheck',
];

export const studioToolNamesByShape = {
  draft: ['continuityCheck', 'grammarCheck', 'expand', 'condense', 'augment'],
  entityCard: ['collectFromDrafts', 'cardAudit', 'relationCheck'],
  sceneCard: ['cardAudit', 'relationCheck'],
} as const satisfies Record<string, readonly StudioAgentToolName[]>;

export interface StudioAgentToolSpan {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly oldText: string;
}

export interface StudioAgentInvokeRequest {
  readonly tool: StudioAgentToolName;
  readonly span?: StudioAgentToolSpan;
  readonly instruction?: string;
}

const spanRequiredTools: ReadonlySet<StudioAgentToolName> = new Set([
  'expand',
  'condense',
  'augment',
]);

export function isSpanRequiredTool(tool: StudioAgentToolName): boolean {
  return spanRequiredTools.has(tool);
}

export type StudioCardFieldValue =
  | string
  | readonly string[]
  | readonly Readonly<Record<string, string>>[];

export interface StudioCardFieldChange {
  readonly field: string;
  readonly value: StudioCardFieldValue;
}

export interface StudioDraftReplacement {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly oldText: string;
  readonly newText: string;
}

export type StudioPatch =
  | { readonly target: 'card'; readonly changes: readonly StudioCardFieldChange[] }
  | { readonly target: 'draft'; readonly replacements: readonly StudioDraftReplacement[] };

export interface StudioAgentFollowUp {
  readonly kind: StudioAgentEntityKind;
  readonly key: string;
  readonly reason: string;
  readonly instruction: string;
}

export type StudioAgentAction =
  | {
      readonly kind: 'say';
      readonly message: string;
      readonly followUps?: readonly StudioAgentFollowUp[];
    }
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
      readonly kind: 'invoke';
      readonly request: StudioAgentInvokeRequest;
      readonly reason?: string;
    }
  | {
      readonly kind: 'propose';
      readonly summary: string;
      readonly message?: string;
      readonly patch: StudioPatch;
      readonly followUps?: readonly StudioAgentFollowUp[];
    };

const maxAskOptions: number = 4;
const maxLookupRequests: number = 4;
const maxFollowUps: number = 5;

export function coerceStudioAgentAction(response: string): StudioAgentAction | undefined {
  const parsed: Record<string, unknown> | null = parseJsonObject(response);

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
    case 'invoke':
      return coerceInvoke(parsed);
    case 'propose':
      return coercePropose(parsed);
    default:
      return undefined;
  }
}

function coerceSay(parsed: Record<string, unknown>): StudioAgentAction | undefined {
  const message: string | undefined = coerceOptionalString(parsed['message']);

  if (!message) {
    return undefined;
  }

  const followUps: StudioAgentFollowUp[] = toFollowUps(parsed['followUps']);

  return followUps.length > 0 ? { kind: 'say', message, followUps } : { kind: 'say', message };
}

function toFollowUps(value: unknown): StudioAgentFollowUp[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(toFollowUp)
    .filter((followUp): followUp is StudioAgentFollowUp => followUp !== undefined)
    .slice(0, maxFollowUps);
}

function toFollowUp(value: unknown): StudioAgentFollowUp | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate: UntypedFields = value as UntypedFields;

  const key: string | undefined = coerceOptionalString(candidate.key);
  const reason: string | undefined = coerceOptionalString(candidate.reason);
  const instruction: string | undefined = coerceOptionalString(candidate.instruction);

  if (!key || !reason || !instruction || !isFollowUpKind(candidate.kind)) {
    return undefined;
  }

  return { kind: candidate.kind, key, reason, instruction };
}

function isFollowUpKind(value: unknown): value is StudioAgentEntityKind {
  return value === 'character' || value === 'background' || value === 'scene';
}

function coerceAsk(parsed: Record<string, unknown>): StudioAgentAction | undefined {
  const question: string | undefined = coerceOptionalString(parsed['question']);

  if (!question) {
    return undefined;
  }

  return {
    kind: 'ask',
    question,
    options: coerceStringList(parsed['options']).slice(0, maxAskOptions),
  };
}

function coerceLookup(parsed: Record<string, unknown>): StudioAgentAction | undefined {
  const rawRequests: unknown[] = Array.isArray(parsed['requests']) ? parsed['requests'] : [];

  const requests: StudioAgentLookupRequest[] = rawRequests
    .map(toLookupRequest)
    .filter((request): request is StudioAgentLookupRequest => request !== undefined)
    .slice(0, maxLookupRequests);

  if (requests.length === 0) {
    return undefined;
  }

  const reason: string | undefined = coerceOptionalString(parsed['reason']);

  return reason ? { kind: 'lookup', requests, reason } : { kind: 'lookup', requests };
}

function toLookupRequest(value: unknown): StudioAgentLookupRequest | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate: UntypedFields = value as UntypedFields;
  const key: string | undefined = coerceOptionalString(candidate.key);

  if (!key || !isLookupKind(candidate.kind)) {
    return undefined;
  }

  return { kind: candidate.kind, key };
}

function isLookupKind(value: unknown): value is StudioAgentLookupRequest['kind'] {
  return value === 'character' || value === 'background' || value === 'scene' || value === 'draft';
}

function coerceInvoke(parsed: Record<string, unknown>): StudioAgentAction | undefined {
  const tool: unknown = parsed['tool'];

  if (!isToolName(tool)) {
    return undefined;
  }

  const span: StudioAgentToolSpan | undefined = toToolSpan(parsed['span']);

  if (isSpanRequiredTool(tool) && !span) {
    return undefined;
  }

  const instruction: string | undefined = coerceOptionalString(parsed['instruction']);
  const reason: string | undefined = coerceOptionalString(parsed['reason']);

  return {
    kind: 'invoke',
    request: {
      tool,
      ...(span === undefined ? {} : { span }),
      ...(instruction === undefined ? {} : { instruction }),
    },
    ...(reason === undefined ? {} : { reason }),
  };
}

function isToolName(value: unknown): value is StudioAgentToolName {
  return studioAgentToolNames.some((name) => name === value);
}

function toToolSpan(value: unknown): StudioAgentToolSpan | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate: UntypedFields = value as UntypedFields;

  if (
    !isNonNegativeInteger(candidate.startOffset) ||
    !isNonNegativeInteger(candidate.endOffset) ||
    typeof candidate.oldText !== 'string' ||
    candidate.oldText.length === 0 ||
    candidate.endOffset <= candidate.startOffset
  ) {
    return undefined;
  }

  return {
    startOffset: candidate.startOffset,
    endOffset: candidate.endOffset,
    oldText: candidate.oldText,
  };
}

function coercePropose(parsed: Record<string, unknown>): StudioAgentAction | undefined {
  const summary: string | undefined = coerceOptionalString(parsed['summary']);
  const patch: StudioPatch | undefined = toPatch(parsed['patch']);

  if (!summary || !patch) {
    return undefined;
  }

  const message: string | undefined = coerceOptionalString(parsed['message']);
  const followUps: StudioAgentFollowUp[] = toFollowUps(parsed['followUps']);

  return {
    kind: 'propose',
    summary,
    ...(message === undefined ? {} : { message }),
    patch,
    ...(followUps.length > 0 ? { followUps } : {}),
  };
}

function toPatch(value: unknown): StudioPatch | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate: UntypedFields = value as UntypedFields;

  if (candidate.target === 'card') {
    const changes: StudioCardFieldChange[] = (
      Array.isArray(candidate.changes) ? candidate.changes : []
    )
      .map(toCardFieldChange)
      .filter((change): change is StudioCardFieldChange => change !== undefined);

    return changes.length > 0 ? { target: 'card', changes } : undefined;
  }

  if (candidate.target === 'draft') {
    const replacements: StudioDraftReplacement[] = (
      Array.isArray(candidate.replacements) ? candidate.replacements : []
    )
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

  const candidate: UntypedFields = value as UntypedFields;
  const field: string | undefined = coerceOptionalString(candidate.field);

  if (!field) {
    return undefined;
  }

  if (typeof candidate.value === 'string') {
    return { field, value: candidate.value };
  }

  if (!Array.isArray(candidate.value)) {
    return undefined;
  }

  const objects: Readonly<Record<string, string>>[] | undefined = stringRecordList(candidate.value);

  return objects ? { field, value: objects } : { field, value: coerceStringList(candidate.value) };
}

function stringRecordList(
  value: readonly unknown[],
): Readonly<Record<string, string>>[] | undefined {
  if (value.length === 0) {
    return undefined;
  }

  const records: (Record<string, string> | undefined)[] = value.map(toStringRecord);

  return records.every((record): record is Record<string, string> => record !== undefined)
    ? records
    : undefined;
}

function toStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const entries: [string, string][] = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, string] =>
      typeof entry[1] === 'string' && entry[1].trim().length > 0,
  );

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function toDraftReplacement(value: unknown): StudioDraftReplacement | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate: UntypedFields = value as UntypedFields;

  if (
    !isNonNegativeInteger(candidate.startOffset) ||
    !isNonNegativeInteger(candidate.endOffset) ||
    typeof candidate.newText !== 'string' ||
    typeof candidate.oldText !== 'string' ||
    candidate.endOffset < candidate.startOffset
  ) {
    return undefined;
  }

  return {
    startOffset: candidate.startOffset,
    endOffset: candidate.endOffset,
    oldText: candidate.oldText,
    newText: candidate.newText,
  };
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
