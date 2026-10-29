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

class CompleteObjectCollector {
  private readonly completeObjects: string[] = [];
  private arrayDepth: number = 0;
  private objectDepth: number = 0;
  private isInString: boolean = false;
  private shouldEscapeNext: boolean = false;
  private currentObjectStart: number = -1;

  public constructor(private readonly jsonText: string) {}

  public readCharacterAt(index: number): boolean {
    const character: string | undefined = this.jsonText[index];

    if (this.isConsumedByString(character)) {
      return false;
    }

    return this.readStructuralCharacter(character, index);
  }

  public toArrayText(): string {
    return `[${this.completeObjects.join(',')}]`;
  }

  private isConsumedByString(character: string | undefined): boolean {
    if (this.shouldEscapeNext) {
      this.shouldEscapeNext = false;
      return true;
    }

    if (character === '\\') {
      this.shouldEscapeNext = true;
      return true;
    }

    if (character === '"') {
      this.isInString = !this.isInString;
      return true;
    }

    return this.isInString;
  }

  private readStructuralCharacter(character: string | undefined, index: number): boolean {
    switch (character) {
      case '{':
        this.openObject(index);
        return false;
      case '}':
        this.closeObject(index);
        return false;
      case '[':
        this.arrayDepth += 1;
        return false;
      case ']':
        return this.closeArray();
      default:
        return false;
    }
  }

  private openObject(index: number): void {
    if (this.objectDepth === 0) {
      this.currentObjectStart = index;
    }

    this.objectDepth += 1;
  }

  private closeObject(index: number): void {
    this.objectDepth -= 1;

    if (this.objectDepth === 0 && this.currentObjectStart !== -1) {
      this.completeObjects.push(this.jsonText.substring(this.currentObjectStart, index + 1));
      this.currentObjectStart = -1;
    }
  }

  private closeArray(): boolean {
    if (this.arrayDepth === 0) {
      return true;
    }

    this.arrayDepth -= 1;
    return false;
  }
}

export function extractCompleteObjectsFromJsonArray(jsonText: string): string {
  const startIndex: number = jsonText.indexOf('[');

  if (startIndex === -1) {
    return jsonText;
  }

  const collector: CompleteObjectCollector = new CompleteObjectCollector(jsonText);

  for (let index: number = startIndex + 1; index < jsonText.length; index += 1) {
    const isOuterArrayClosed: boolean = collector.readCharacterAt(index);

    if (isOuterArrayClosed) {
      break;
    }
  }

  return collector.toArrayText();
}
