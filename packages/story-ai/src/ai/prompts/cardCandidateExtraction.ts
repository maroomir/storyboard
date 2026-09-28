import { renderPrompt } from './promptResource';
import { type PromptArtifact, type PromptVariantId } from './types';
import { promptTuning } from './promptTuning';

export interface CardCandidateExtraction {
  readonly attributes: readonly { readonly key: string; readonly value: string }[];
  readonly relations: readonly { readonly target: string; readonly type: string }[];
  readonly description: readonly string[];
  readonly voice: readonly string[];
  readonly desire: readonly string[];
  readonly arc?: { readonly summary: string };
}

export const CardCandidateExtractionPrompt = {
  config: promptTuning('cardCandidateExtraction'),
  build(
    body: string,
    characterName: string,
    aliases?: readonly string[],
    variant: PromptVariantId = 'generic',
  ): PromptArtifact {
    return renderPrompt('cardCandidateExtraction', variant, {
      view: { body, characterName, aliasList: quoteAliases(aliases) },
    });
  },
} as const;

function quoteAliases(aliases?: readonly string[]): string {
  return (aliases ?? [])
    .map((alias) => alias.trim())
    .filter((alias) => alias.length > 0)
    .map((alias) => `"${alias}"`)
    .join(', ');
}

export function coerceCardCandidateExtraction(
  value: Record<string, unknown> | null,
): CardCandidateExtraction {
  if (value === null) {
    return { attributes: [], relations: [], description: [], voice: [], desire: [] };
  }

  return {
    attributes: coerceStringRecords(value.attributes, 'key', 'value').map((entry) => ({
      key: entry.left,
      value: entry.right,
    })),
    relations: coerceStringRecords(value.relations, 'target', 'type').map((entry) => ({
      target: entry.left,
      type: entry.right,
    })),
    description: coerceStringList(value.description),
    voice: coerceStringList(value.voice),
    desire: coerceStringList(value.desire),
    ...coerceArc(value.arc),
  };
}

function coerceStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function coerceStringRecords(
  value: unknown,
  leftField: string,
  rightField: string,
): { readonly left: string; readonly right: string }[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const records: { readonly left: string; readonly right: string }[] = [];

  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const left = record[leftField];
    const right = record[rightField];

    if (
      typeof left === 'string' &&
      typeof right === 'string' &&
      left.trim().length > 0 &&
      right.trim().length > 0
    ) {
      records.push({ left: left.trim(), right: right.trim() });
    }
  }

  return records;
}

function coerceArc(value: unknown): { readonly arc?: { readonly summary: string } } {
  if (typeof value !== 'object' || value === null) {
    return {};
  }

  const summary = (value as Record<string, unknown>).summary;

  if (typeof summary !== 'string' || summary.trim().length === 0) {
    return {};
  }

  return { arc: { summary: summary.trim() } };
}
