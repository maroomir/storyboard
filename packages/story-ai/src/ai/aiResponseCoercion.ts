import type { AiMessage, Severity, UsageAttribution } from '@storyboard/story-model';
import type { PromptArtifact } from './prompts/types';


type UntypedFields = Readonly<Record<string, unknown>>;

export interface SituationWithCharacters {
  readonly characters: readonly string[];
  readonly situation: string;
}

export interface FactCandidate {
  readonly key: string;
  readonly value: string;
}

export interface GrammarIssue {
  readonly start: number;
  readonly end: number;
  readonly original: string;
  readonly suggestion: string;
  readonly reason: string;
}

export interface ContinuityIssue {
  readonly start: number;
  readonly end: number;
  readonly original: string;
  readonly reason: string;
  readonly severity: Severity;
  readonly sceneStem?: string;
}

export function isAttributed(attribution: UsageAttribution): boolean {
  return Boolean(attribution.primary) || (attribution.participants?.length ?? 0) > 0;
}

export function toSituationWithCharacters(value: unknown): SituationWithCharacters[] {
  if (!value || typeof value !== 'object') {
    return [];
  }

  const candidate: UntypedFields = value as UntypedFields;

  if (typeof candidate.situation !== 'string') {
    return [];
  }

  const characters: string[] = Array.isArray(candidate.characters)
    ? candidate.characters.filter((character): character is string => typeof character === 'string')
    : [];

  return [
    {
      situation: candidate.situation,
      characters,
    },
  ];
}

export function toGrammarIssue(value: unknown): GrammarIssue[] {
  if (!value || typeof value !== 'object') {
    return [];
  }

  const candidate: UntypedFields = value as UntypedFields;

  if (
    typeof candidate.start !== 'number' ||
    typeof candidate.end !== 'number' ||
    typeof candidate.original !== 'string' ||
    typeof candidate.suggestion !== 'string' ||
    typeof candidate.reason !== 'string'
  ) {
    return [];
  }

  if (candidate.start < 0 || candidate.end < candidate.start) {
    return [];
  }

  return [
    {
      start: candidate.start,
      end: candidate.end,
      original: candidate.original,
      suggestion: candidate.suggestion,
      reason: candidate.reason,
    },
  ];
}

export function toFactCandidate(value: unknown): FactCandidate[] {
  if (!value || typeof value !== 'object') {
    return [];
  }

  const candidate: UntypedFields = value as UntypedFields;

  if (typeof candidate.key !== 'string' || typeof candidate.value !== 'string') {
    return [];
  }

  const key: string = candidate.key.trim();
  const factValue: string = candidate.value.trim();

  if (key.length === 0 || factValue.length === 0) {
    return [];
  }

  return [{ key, value: factValue }];
}

export function toContinuityIssue(value: unknown): ContinuityIssue[] {
  if (!value || typeof value !== 'object') {
    return [];
  }

  const candidate: UntypedFields = value as UntypedFields;

  if (
    typeof candidate.start !== 'number' ||
    typeof candidate.end !== 'number' ||
    typeof candidate.original !== 'string' ||
    typeof candidate.reason !== 'string'
  ) {
    return [];
  }

  if (candidate.start < 0 || candidate.end < candidate.start) {
    return [];
  }

  const severity: Severity = candidate.severity === 'low' ? 'low' : 'high';

  return [
    {
      start: candidate.start,
      end: candidate.end,
      original: candidate.original,
      reason: candidate.reason,
      severity,
      ...(typeof candidate.sceneStem === 'string' && candidate.sceneStem.trim().length > 0
        ? { sceneStem: candidate.sceneStem.trim() }
        : {}),
    },
  ];
}

export function toPromptMessages(artifact: PromptArtifact): readonly AiMessage[] {
  const prefix: AiMessage[] =
    artifact.userPrefix === undefined || artifact.userPrefix.trim().length === 0
      ? []
      : [
          {
            role: 'user',
            content: artifact.userPrefix,
            cacheBoundary: true,
            ...(artifact.prefixCacheTtl === undefined ? {} : { cacheTtl: artifact.prefixCacheTtl }),
          },
        ];

  return [{ role: 'system', content: artifact.system }, ...prefix, { role: 'user', content: artifact.user }];
}
