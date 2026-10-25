import { z } from 'zod';

import { pointOfViews, type PointOfView } from './project';

export type NarratorPerson = 'first' | 'second' | 'third';

export const narratorPersons: readonly [NarratorPerson, ...NarratorPerson[]] = [
  'first',
  'second',
  'third',
];

export type NarratorKnowledge = 'witnessed' | 'omniscient' | 'retrospective';

export const narratorKnowledges: readonly [NarratorKnowledge, ...NarratorKnowledge[]] = [
  'witnessed',
  'omniscient',
  'retrospective',
];

export type NarrativeTense = 'past' | 'present';

export const narrativeTenses: readonly [NarrativeTense, ...NarrativeTense[]] = ['past', 'present'];

export const narratorPersonLabels: Record<NarratorPerson, string> = {
  first: '1인칭',
  second: '2인칭',
  third: '3인칭',
};

export const narratorKnowledgeLabels: Record<NarratorKnowledge, string> = {
  witnessed: '목격 범위',
  omniscient: '전지',
  retrospective: '회고',
};

export const narrativeTenseLabels: Record<NarrativeTense, string> = {
  past: '과거형',
  present: '현재형',
};

const narratorIdPattern: RegExp = /^[a-z0-9][a-z0-9-]*$/;

export interface NarratorCard {
  type: 'narrator';
  id: string;
  name: string;
  person: NarratorPerson;
  knowledge: NarratorKnowledge;
  tense?: NarrativeTense;
  focal?: string;
  voice?: string[];
}

export const narratorCardSchema: z.ZodType<NarratorCard> = z.object({
  type: z.literal('narrator'),
  id: z.string().regex(narratorIdPattern, {
    message: 'Narrator id는 영소문자·숫자·하이픈만 쓸 수 있습니다.',
  }),
  name: z.string().trim().min(1),
  person: z.enum(narratorPersons),
  knowledge: z.enum(narratorKnowledges),
  tense: z.enum(narrativeTenses).optional(),
  focal: z.string().trim().min(1).optional(),
  voice: z.array(z.string().trim().min(1)).optional(),
});

export interface NarrationDirective {
  readonly person?: NarratorPerson;
  readonly knowledge?: NarratorKnowledge;
  readonly tense?: NarrativeTense;
  readonly focal?: string;
  readonly voice?: readonly string[];
  readonly narratorId?: string;
}

export interface PointOfViewDerivation {
  readonly person: NarratorPerson;
  readonly knowledge: NarratorKnowledge;
}

const pointOfViewDerivations: Record<PointOfView, PointOfViewDerivation> = {
  first: { person: 'first', knowledge: 'witnessed' },
  'first-retrospective': { person: 'first', knowledge: 'retrospective' },
  second: { person: 'second', knowledge: 'witnessed' },
  'third-limited': { person: 'third', knowledge: 'witnessed' },
  'third-omniscient': { person: 'third', knowledge: 'omniscient' },
};

export function deriveNarrationFromPointOfView(pov: PointOfView): PointOfViewDerivation {
  return pointOfViewDerivations[pov];
}

export type NarrationErrorCode = 'unknown-narrator';

export class NarrationError extends Error {
  public constructor(
    public readonly code: NarrationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'NarrationError';
  }
}

export interface NarrationSources {
  readonly sceneNarrator?: string;
  readonly chapterNarrator?: string;
  readonly defaultNarrator?: string;
  readonly pov?: PointOfView;
  readonly focalFallback?: string;
  readonly narrators?: ReadonlyMap<string, NarratorCard>;
}

export function resolveNarration(sources: NarrationSources): NarrationDirective | undefined {
  const narrator: NarratorCard | undefined = resolveNarratorCard(sources);
  const focal: string | undefined = narrator?.focal ?? trimmed(sources.focalFallback);

  if (narrator) {
    return compact({
      person: narrator.person,
      knowledge: narrator.knowledge,
      tense: narrator.tense ?? 'past',
      focal,
      voice: narrator.voice && narrator.voice.length > 0 ? narrator.voice : undefined,
      narratorId: narrator.id,
    });
  }

  const derived: PointOfViewDerivation | undefined = sources.pov
    ? pointOfViewDerivations[sources.pov]
    : undefined;

  return compact({
    person: derived?.person,
    knowledge: derived?.knowledge,
    tense: derived ? 'past' : undefined,
    focal,
  });
}

function resolveNarratorCard(sources: NarrationSources): NarratorCard | undefined {
  const id: string | undefined =
    trimmed(sources.sceneNarrator) ??
    trimmed(sources.chapterNarrator) ??
    trimmed(sources.defaultNarrator);

  if (id === undefined) {
    return undefined;
  }

  const narrator: NarratorCard | undefined = sources.narrators?.get(id);

  if (!narrator) {
    throw new NarrationError(
      'unknown-narrator',
      `서술자 '${id}'를 찾을 수 없습니다. narrator/${id}.card 를 만들거나 참조를 고쳐 주세요.`,
    );
  }

  return narrator;
}

function compact(directive: NarrationDirective): NarrationDirective | undefined {
  const entries: [string, unknown][] = Object.entries(directive).filter(
    ([, value]) => value !== undefined,
  );

  return entries.length > 0 ? (Object.fromEntries(entries) as NarrationDirective) : undefined;
}

function trimmed(value: string | undefined): string | undefined {
  const text: string | undefined = value?.trim();
  return text !== undefined && text.length > 0 ? text : undefined;
}

export function isPointOfView(value: string): value is PointOfView {
  return (pointOfViews as readonly string[]).includes(value);
}
