// Loose text matching for placing a model's quote or paraphrase back in the text it came from.

export function normalizeForMatch(text: string): string {
  return text.replace(/[\s"'“”‘’「」『』.,!?…·~\-—()[\]]/g, '');
}

const shingleLength = 4;

// How many distinct four-character runs of the needle the haystack contains. Both are expected to
// be normalized already.
export function countSharedShingles(needle: string, haystack: string): number {
  const seen = new Set<string>();

  for (let index = 0; index + shingleLength <= needle.length; index += 1) {
    const shingle = needle.slice(index, index + shingleLength);
    if (haystack.includes(shingle)) {
      seen.add(shingle);
    }
  }

  return seen.size;
}
