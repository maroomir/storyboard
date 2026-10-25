export function normalizeForMatch(text: string): string {
  return text.replace(/[\s"'“”‘’「」『』.,!?…·~\-—()[\]]/g, '');
}

const shingleLength: number = 4;

export function countSharedShingles(needle: string, haystack: string): number {
  const seen: Set<string> = new Set<string>();

  for (let index: number = 0; index + shingleLength <= needle.length; index += 1) {
    const shingle: string = needle.slice(index, index + shingleLength);
    if (haystack.includes(shingle)) {
      seen.add(shingle);
    }
  }

  return seen.size;
}
