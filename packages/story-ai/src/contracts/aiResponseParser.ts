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
  const greedy = match ? toPlainObject(match[0]) : null;

  // NOTE: the greedy span runs to the last brace in the response, so a stray trailing brace or a
  // closing remark would throw away an otherwise good object; fall back to the first span that
  // actually balances.
  return greedy ?? scanBalancedObject(response);
}

function scanBalancedObject(response: string): Record<string, unknown> | null {
  for (let start = response.indexOf('{'); start !== -1; start = response.indexOf('{', start + 1)) {
    const end = findBalancedEnd(response, start);

    if (end === -1) {
      continue;
    }

    const parsed = toPlainObject(response.slice(start, end + 1));

    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function findBalancedEnd(text: string, start: number): number {
  let depth = 0;
  let isInString = false;
  let isEscaped = false;

  for (let index = start; index < text.length; index += 1) {
    const character = text[index];

    if (isEscaped) {
      isEscaped = false;
      continue;
    }

    if (character === '\\' && isInString) {
      isEscaped = true;
      continue;
    }

    if (character === '"') {
      isInString = !isInString;
      continue;
    }

    if (isInString) {
      continue;
    }

    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function toPlainObject(candidate: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(candidate);

    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
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
