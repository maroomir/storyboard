import { parseJsonObject } from './aiResponseParser';

export interface StudioCardSeed {
  readonly kind: 'character' | 'background';
  readonly name: string;
  readonly id: string;
}

// NOTE: the id becomes a file name, so it is held to the card id grammar here rather than trusted
// to the prompt.
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
