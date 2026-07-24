export function parseJsonArray(response: string): unknown[] | null {
  const match = response.match(/\[[\s\S]*\]/);

  if (!match) {
    return null;
  }

  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseJsonObject(response: string): Record<string, unknown> | null {
  const match = response.match(/\{[\s\S]*\}/);

  if (!match) {
    return null;
  }

  try {
    const parsed = JSON.parse(match[0]);

    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }

    return null;
  } catch {
    return null;
  }
}

export function parseJsonNestedArray(response: string): unknown[][] | null {
  const match = response.match(/\[\s*(?:\[[\s\S]*?\]\s*,?\s*)*\s*\]/);

  if (!match) {
    return null;
  }

  try {
    const parsed = JSON.parse(match[0]);

    if (!Array.isArray(parsed)) {
      return null;
    }

    return parsed.filter((group): group is unknown[] => Array.isArray(group) && group.length >= 2);
  } catch {
    return null;
  }
}

export function parseBulletList(response: string): string[] {
  return response
    .split('\n')
    .filter((line) => line.trim().startsWith('-'))
    .map((line) => line.trim().replace(/^-\s*/, ''))
    .filter((item) => item.length > 0);
}

export function parseMBTI(response: string): string | null {
  const match = response.match(/[IE][NS][FT][JP]/);
  return match ? match[0] : null;
}

export function parseCharacterTraitSections(
  response: string,
  characterNames: readonly string[],
): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  for (const name of characterNames) {
    const pattern = new RegExp(`\\[${escapeRegExp(name)}\\]([\\s\\S]*?)(?=\\[|$)`, 'g');
    const matches = response.match(pattern);
    result[name] = matches ? parseBulletList(matches[0]) : [];
  }

  return result;
}

export function detectCharactersFromDialogue(script: string): string[] {
  const pattern = /^([^:\n]+):/gm;
  const names = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(script)) !== null) {
    const name = match[1]?.trim().replace(/^["']|["']$/g, '');

    if (name && name.length >= 2 && name.length <= 10) {
      names.add(name);
    }
  }

  return Array.from(names);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
