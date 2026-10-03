import { z } from 'zod';

import { pointOfViews, type PointOfView } from './project';

// NOTE: 서술 시점은 작품 하나에 하나였다. 시점 교차·옴니버스는 서술 단위마다 시점이 달라야 하므로,
// 시점을 이름 붙인 카드로 만들어 씬·장이 고를 수 있게 한다. 카드를 만들지 않은 프로젝트는
// `setting.pov` 하나만으로 종전과 같이 동작한다 — 그 값에서 암묵 서술자를 파생한다.

export const narratorPersons = ['first', 'second', 'third'] as const;

export type NarratorPerson = (typeof narratorPersons)[number];

// witnessed: 초점 인물이 직접 겪거나 지각한 것만 안다.
// omniscient: 모든 인물의 내면과 아직 일어나지 않은 일까지 안다.
// retrospective: 초점 인물이 결말을 이미 아는 자리에서 회고한다.
export const narratorKnowledges = ['witnessed', 'omniscient', 'retrospective'] as const;

export type NarratorKnowledge = (typeof narratorKnowledges)[number];

export const narrativeTenses = ['past', 'present'] as const;

export type NarrativeTense = (typeof narrativeTenses)[number];

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

const narratorIdPattern = /^[a-z0-9][a-z0-9-]*$/;

export const narratorCardSchema = z.object({
  type: z.literal('narrator'),
  id: z.string().regex(narratorIdPattern, {
    message: 'Narrator id는 영소문자·숫자·하이픈만 쓸 수 있습니다.',
  }),
  name: z.string().trim().min(1),
  person: z.enum(narratorPersons),
  knowledge: z.enum(narratorKnowledges),
  tense: z.enum(narrativeTenses).optional(),
  // 초점 인물 카드 id. 씬이 `povCharacter`로 정하는 경우가 많아 카드에서는 선택이다.
  focal: z.string().trim().min(1).optional(),
  voice: z.array(z.string().trim().min(1)).optional(),
});

export type NarratorCard = z.infer<typeof narratorCardSchema>;

// 프롬프트·검수·연속성 필터가 보는 유일한 시점 표현. 서술자 카드에서 왔든 `setting.pov`에서
// 파생됐든 이 형태로 수렴한다.
export interface NarrationDirective {
  readonly person?: NarratorPerson;
  readonly knowledge?: NarratorKnowledge;
  readonly tense?: NarrativeTense;
  readonly focal?: string;
  readonly voice?: readonly string[];
  readonly narratorId?: string;
}

interface PointOfViewDerivation {
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
  // 씬 > 장 > 프로젝트 기본 순으로 서술자 카드를 고른다.
  readonly sceneNarrator?: string;
  readonly chapterNarrator?: string;
  readonly defaultNarrator?: string;
  readonly pov?: PointOfView;
  // 서술자 카드가 초점을 정하지 않았을 때 쓰는 씬의 초점 인물(`povCharacter` 등).
  readonly focalFallback?: string;
  readonly narrators?: ReadonlyMap<string, NarratorCard>;
}

// NOTE: 아무것도 정해지지 않았으면 undefined를 돌려준다. 기본 시점을 끼워 넣으면 시점을 설정한 적
// 없는 기존 작품의 프롬프트에 없던 지시가 들어가 결과가 달라진다.
export function resolveNarration(sources: NarrationSources): NarrationDirective | undefined {
  const narrator = resolveNarratorCard(sources);
  const focal = narrator?.focal ?? trimmed(sources.focalFallback);

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

  const derived = sources.pov ? pointOfViewDerivations[sources.pov] : undefined;

  return compact({
    person: derived?.person,
    knowledge: derived?.knowledge,
    tense: derived ? 'past' : undefined,
    focal,
  });
}

function resolveNarratorCard(sources: NarrationSources): NarratorCard | undefined {
  const id =
    trimmed(sources.sceneNarrator) ??
    trimmed(sources.chapterNarrator) ??
    trimmed(sources.defaultNarrator);

  if (id === undefined) {
    return undefined;
  }

  const narrator = sources.narrators?.get(id);

  // 없는 서술자를 조용히 기본값으로 떨어뜨리면 잘못된 시점으로 초안을 덮어쓴다. 씬 카드의 오타는
  // 생성 전에 계약 검증과 doctor가 잡고, 여기서는 소리 내어 실패한다.
  if (!narrator) {
    throw new NarrationError(
      'unknown-narrator',
      `서술자 '${id}'를 찾을 수 없습니다. narrator/${id}.card 를 만들거나 참조를 고쳐 주세요.`,
    );
  }

  return narrator;
}

function compact(directive: NarrationDirective): NarrationDirective | undefined {
  const entries = Object.entries(directive).filter(([, value]) => value !== undefined);

  return entries.length > 0 ? (Object.fromEntries(entries) as NarrationDirective) : undefined;
}

function trimmed(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text !== undefined && text.length > 0 ? text : undefined;
}

export function isPointOfView(value: string): value is PointOfView {
  return (pointOfViews as readonly string[]).includes(value);
}
