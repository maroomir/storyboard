import type { NoteDocument } from '#model/shared/noteAbsorb';

export const noteChunkCharacterLimit: number = 12_000;

const charactersPerToken: number = 1.5;
const instructionTokensPerRequest: number = 1_200;

function splitOversizedNote(note: NoteDocument): NoteDocument[] {
  if (note.body.length <= noteChunkCharacterLimit) {
    return [note];
  }

  const parts: NoteDocument[] = [];

  for (let start: number = 0; start < note.body.length; start += noteChunkCharacterLimit) {
    parts.push({ ...note, body: note.body.slice(start, start + noteChunkCharacterLimit) });
  }

  return parts;
}

export function groupNotesIntoChunks(notes: readonly NoteDocument[]): NoteDocument[][] {
  const chunks: NoteDocument[][] = [];
  let current: NoteDocument[] = [];
  let currentSize: number = 0;

  for (const note of notes.flatMap(splitOversizedNote)) {
    const noteSize: number = note.title.length + note.body.length;

    if (current.length > 0 && currentSize + noteSize > noteChunkCharacterLimit) {
      chunks.push(current);
      current = [];
      currentSize = 0;
    }

    current.push(note);
    currentSize += noteSize;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
}

export interface NoteAbsorbWorkload {
  readonly noteCount: number;
  readonly linkedNoteCount: number;
  readonly characterCount: number;
  readonly requestCount: number;
  readonly inputTokens: number;
  readonly outputTokenCeiling: number;
}

export function measureNoteAbsorbWorkload(
  notes: readonly NoteDocument[],
  outputLimits: {
    readonly extractionMaxTokens: number;
    readonly synthesisMaxTokens: number;
    readonly consolidationMaxTokens: number;
  },
): NoteAbsorbWorkload {
  const extractionRequestCount: number = groupNotesIntoChunks(notes).length;
  const consolidationRequestCount: number = extractionRequestCount * 3;
  const requestCount: number = extractionRequestCount + 1 + consolidationRequestCount;
  const characterCount: number = notes.reduce(
    (total, note) => total + note.title.length + note.body.length,
    0,
  );

  return {
    noteCount: notes.length,
    linkedNoteCount: notes.filter((note) => note.origin === 'link').length,
    characterCount,
    requestCount,
    inputTokens:
      Math.ceil(characterCount / charactersPerToken) + requestCount * instructionTokensPerRequest,
    outputTokenCeiling:
      extractionRequestCount * outputLimits.extractionMaxTokens +
      outputLimits.synthesisMaxTokens +
      consolidationRequestCount * outputLimits.consolidationMaxTokens,
  };
}
