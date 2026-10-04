import type { NoteDocument } from '#model/shared/noteAbsorb';

// NOTE: 한 요청이 읽는 노트 분량. 출력 한도(noteExtraction 의 maxTokens)와 함께 정해진다. 2026-10
// 실측에서 claude-sonnet-5 는 3.6천자 노트 한 장에 사고 2.5천 + 본문 5.1천 토큰을 썼고, 4만 자
// 묶음은 출력 8천 토큰을 사고로 다 써 본문 없이 잘렸다.
export const noteChunkCharacterLimit = 12_000;

// NOTE: 견적용 어림값이다. 한글은 글자당 토큰이 영문보다 많아 1.5자를 1토큰으로 잡고, 요청마다
// 붙는 지시문 몫을 따로 더한다. 실제 사용량은 모델의 토크나이저가 정한다.
const charactersPerToken = 1.5;
const instructionTokensPerRequest = 1_200;

function splitOversizedNote(note: NoteDocument): NoteDocument[] {
  if (note.body.length <= noteChunkCharacterLimit) {
    return [note];
  }

  const parts: NoteDocument[] = [];

  for (let start = 0; start < note.body.length; start += noteChunkCharacterLimit) {
    parts.push({ ...note, body: note.body.slice(start, start + noteChunkCharacterLimit) });
  }

  return parts;
}

// Notes stay in collection order, so what one request sees is a contiguous run of the notebook.
export function groupNotesIntoChunks(notes: readonly NoteDocument[]): NoteDocument[][] {
  const chunks: NoteDocument[][] = [];
  let current: NoteDocument[] = [];
  let currentSize = 0;

  for (const note of notes.flatMap(splitOversizedNote)) {
    const noteSize = note.title.length + note.body.length;

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
  // The most the requests may write, not what they are expected to: each one is capped by its
  // prompt's `maxTokens`.
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
  const extractionRequestCount = groupNotesIntoChunks(notes).length;
  // Synthesis and character consolidation run only when the notes call for them; both are counted.
  const requestCount = extractionRequestCount + 2;
  const characterCount = notes.reduce(
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
      outputLimits.consolidationMaxTokens,
  };
}
