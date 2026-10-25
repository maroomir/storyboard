import type { BibleSubjectKind } from '#model/format/bible';
import { parseJsonObject } from './aiResponseParser';

export interface StudioCardSeed {
  readonly kind: BibleSubjectKind;
  readonly name: string;
  readonly id: string;
}

const cardSeedIdPattern: RegExp = /^[a-z0-9][a-z0-9-]*$/;

export function coerceStudioCardSeed(response: string): StudioCardSeed | undefined {
  const parsed: Record<string, unknown> | null = parseJsonObject(response);

  if (!parsed) {
    return undefined;
  }

  const kind: unknown = parsed['kind'];
  const name: string = typeof parsed['name'] === 'string' ? parsed['name'].trim() : '';
  const id: string = typeof parsed['id'] === 'string' ? parsed['id'].trim().toLowerCase() : '';

  if (
    (kind !== 'character' && kind !== 'background') ||
    name.length === 0 ||
    !cardSeedIdPattern.test(id)
  ) {
    return undefined;
  }

  return { kind, name, id };
}
