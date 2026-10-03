import { z } from 'zod';

import { characterRoles } from '@storyboard/story-model';
import { renderPrompt } from './promptResource';
import { promptTuning } from './promptTuning';
import { type PromptArtifact, type PromptVariantId } from './types';

// What a note may hold. `other` alone means nothing in the note belongs in the workspace.
export const noteKinds = ['character', 'background', 'scene', 'premise', 'other'] as const;

export type NoteKind = (typeof noteKinds)[number];

export interface NoteExtractionNote {
  readonly id: string;
  readonly title: string;
  readonly path: readonly string[];
  readonly body: string;
}

export interface NoteExtractionKnownCard {
  readonly id: string;
  readonly type: 'character' | 'background';
  readonly name: string;
  readonly aliases: readonly string[];
}

// NOTE: zod 4 는 빠진 키를 preprocess 에 넘기지 않고 바로 거부한다. 목록 칸은 optional 로 받고
// 없으면 빈 배열로 채워, 모델이 칸 하나를 빼먹었다고 항목 전체가 버려지지 않게 한다.
function emptyWhenMissing<T extends z.ZodType>(schema: T) {
  return schema.optional().transform((value) => value ?? []);
}

// 모델은 «모르는 값» 을 빈 문자열로 적어 보낸다. 그것을 오류로 세면 노트 수십 장을 읽은 응답이
// 빈 칸 하나 때문에 통째로 버려지므로, 빈 값은 안 적은 것으로 읽고 목록에서는 걸러 낸다.
const optionalText = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
  z.string().trim().min(1).optional(),
);

function textList() {
  return emptyWhenMissing(
    z.preprocess(
      (value) =>
        Array.isArray(value)
          ? value.filter((item) => typeof item === 'string' && item.trim().length > 0)
          : [],
      z.array(z.string().trim().min(1)),
    ),
  );
}

function recordList<T extends z.ZodType>(item: T) {
  return emptyWhenMissing(
    z.preprocess(
      (value) =>
        Array.isArray(value) ? value.filter((entry) => item.safeParse(entry).success) : [],
      z.array(item),
    ),
  );
}

const noteClassificationSchema = z.object({
  id: z.string().trim().min(1),
  kinds: emptyWhenMissing(
    z.preprocess(
      (value) =>
        Array.isArray(value)
          ? value.filter((kind) => (noteKinds as readonly unknown[]).includes(kind))
          : [],
      z.array(z.enum(noteKinds)),
    ),
  ),
});

const noteEntitySchema = z.object({
  type: z.enum(['character', 'background']),
  name: z.string().trim().min(1),
  suggestedId: optionalText,
  existingId: optionalText,
  role: z.preprocess(
    (value) => ((characterRoles as readonly unknown[]).includes(value) ? value : undefined),
    z.enum(characterRoles).optional(),
  ),
  aliases: textList(),
  tags: textList(),
  traits: textList(),
  description: textList(),
  voice: textList(),
  desire: textList(),
  attributes: recordList(
    z.object({ key: z.string().trim().min(1), value: z.string().trim().min(1) }),
  ),
  relations: recordList(
    z.object({ target: z.string().trim().min(1), type: z.string().trim().min(1) }),
  ),
  senses: textList(),
  time: optionalText,
  weather: optionalText,
  characterNames: textList(),
  sourceNotes: textList(),
});

const noteSceneSchema = z.object({
  title: z.string().trim().min(1),
  slug: optionalText,
  summary: z.string().trim().min(1),
  characterNames: textList(),
  locationName: optionalText,
  mood: optionalText,
  purpose: optionalText,
  sourceNote: optionalText,
});

export type NoteClassification = z.infer<typeof noteClassificationSchema>;
export type NoteExtractionEntity = z.infer<typeof noteEntitySchema>;
export type NoteExtractionScene = z.infer<typeof noteSceneSchema>;

export interface NoteExtraction {
  readonly notes: readonly NoteClassification[];
  readonly entities: readonly NoteExtractionEntity[];
  readonly scenes: readonly NoteExtractionScene[];
  readonly premise: readonly string[];
}

function renderNote(note: NoteExtractionNote): string {
  return [
    `### 노트 id: ${note.id}`,
    ...(note.path.length > 0 ? [`위치: ${note.path.join(' > ')}`] : []),
    `제목: ${note.title}`,
    '',
    note.body.trim(),
  ].join('\n');
}

function renderKnownCard(card: NoteExtractionKnownCard): string {
  const aliases = card.aliases.length > 0 ? ` (다른 호칭: ${card.aliases.join(', ')})` : '';

  return `- ${card.id} · ${card.type === 'character' ? '인물' : '배경'} · ${card.name}${aliases}`;
}

export const NoteExtractionPrompt = {
  config: promptTuning('noteExtraction'),
  build(
    notes: readonly NoteExtractionNote[],
    knownCards: readonly NoteExtractionKnownCard[],
    variant: PromptVariantId = 'generic',
  ): PromptArtifact {
    return renderPrompt('noteExtraction', variant, {
      view: {
        hasKnownCards: knownCards.length > 0,
        knownCards: knownCards.map(renderKnownCard).join('\n'),
        notes: notes.map(renderNote).join('\n\n'),
      },
    });
  },
} as const;

// One malformed entry must not cost the rest of the response, so each list keeps what parses.
function salvageList<T>(value: unknown, schema: z.ZodType<T>): T[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const parsed = schema.safeParse(entry);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
}

export function coerceNoteExtraction(value: Record<string, unknown> | null): NoteExtraction {
  return {
    notes: salvageList(value?.notes, noteClassificationSchema),
    entities: salvageList(value?.entities, noteEntitySchema),
    scenes: salvageList(value?.scenes, noteSceneSchema),
    premise: textList().parse(value?.premise),
  };
}
