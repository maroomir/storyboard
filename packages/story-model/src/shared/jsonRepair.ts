export function findFirstJsonArray(text: string): string | null {
  const startIndex: number = text.indexOf('[');

  if (startIndex === -1) {
    return null;
  }

  let depth: number = 0;
  let isInString: boolean = false;
  let shouldEscapeNext: boolean = false;

  for (let index: number = startIndex; index < text.length; index += 1) {
    const character: string | undefined = text[index];

    if (shouldEscapeNext) {
      shouldEscapeNext = false;
      continue;
    }

    if (character === '\\') {
      shouldEscapeNext = true;
      continue;
    }

    if (character === '"') {
      isInString = !isInString;
      continue;
    }

    if (isInString) {
      continue;
    }

    if (character === '[') {
      depth += 1;
    } else if (character === ']') {
      depth -= 1;

      if (depth === 0) {
        return text.substring(startIndex, index + 1);
      }
    }
  }

  return null;
}

export function extractCompleteObjectsFromJsonArray(jsonText: string): string {
  const startIndex: number = jsonText.indexOf('[');

  if (startIndex === -1) {
    return jsonText;
  }

  const completeObjects: string[] = [];
  let arrayDepth: number = 0;
  let objectDepth: number = 0;
  let isInString: boolean = false;
  let shouldEscapeNext: boolean = false;
  let currentObjectStart: number = -1;

  for (let index: number = startIndex + 1; index < jsonText.length; index += 1) {
    const character: string | undefined = jsonText[index];

    if (shouldEscapeNext) {
      shouldEscapeNext = false;
      continue;
    }

    if (character === '\\') {
      shouldEscapeNext = true;
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
      if (objectDepth === 0) {
        currentObjectStart = index;
      }

      objectDepth += 1;
    } else if (character === '}') {
      objectDepth -= 1;

      if (objectDepth === 0 && currentObjectStart !== -1) {
        completeObjects.push(jsonText.substring(currentObjectStart, index + 1));
        currentObjectStart = -1;
      }
    } else if (character === '[') {
      arrayDepth += 1;
    } else if (character === ']') {
      if (arrayDepth === 0) {
        break;
      }

      arrayDepth -= 1;
    }
  }

  return `[${completeObjects.join(',')}]`;
}
