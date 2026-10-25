import { z } from 'zod';

import { resolveSceneOrder } from './scene';

export const storyBibleVersion: string = '1.0.0';

export const bibleFactStatuses = ['canon', 'candidate'] as const;
export type BibleFactStatus = (typeof bibleFactStatuses)[number];

export const bibleSubjectKinds = ['character', 'background'] as const;

export interface BibleFactSubject {
  kind: 'character' | 'background';
  id: string;
}

export const bibleFactSubjectSchema: z.ZodType<BibleFactSubject> = z.object({
  kind: z.enum(bibleSubjectKinds),
  id: z.string().trim().min(1),
});

// A scene reference is an `NN-slug` stem or a bare order; both resolve to a numeric scene order.
const sceneReferenceSchema: z.ZodType<string | number> = z.union([
  z.string().trim().min(1),
  z.number().int().positive(),
]);

type RevealFrom = string | number | { scene: string | number; knownBy?: string[] };

const revealFromSchema: z.ZodType<RevealFrom> = z.union([
  sceneReferenceSchema,
  z.object({
    scene: sceneReferenceSchema,
    // 이 사실을 아는 인물 카드 id. 적으면 나머지 등장 인물은 '아직 모름'으로 표시된다.
    knownBy: z.array(z.string().trim().min(1)).optional(),
  }),
]);

export interface BibleFact {
  id: string;
  subject: BibleFactSubject;
  key: string;
  value: string;
  status: BibleFactStatus;
  sourceScene?: string;
  validFrom?: string | number;
  validUntil?: string | number;
  revealFrom?: string | number | { scene: string | number; knownBy?: string[] };
  keywords?: string[];
}

export const bibleFactSchema: z.ZodType<BibleFact> = z
  .object({
    id: z.string().trim().min(1),
    subject: bibleFactSubjectSchema,
    key: z.string().trim().min(1),
    value: z.string().trim().min(1),
    status: z.enum(bibleFactStatuses).default('canon'),
    sourceScene: z.string().trim().min(1).optional(),
    validFrom: sceneReferenceSchema.optional(),
    validUntil: sceneReferenceSchema.optional(),
    // NOTE: validFrom은 사실이 '참'이 되는 시점이고, revealFrom은 독자·인물에게 '밝혀지는' 시점이다.
    // 결말의 반전은 1화부터 참이지만 회수 씬 전에는 프롬프트에 넣으면 안 되므로 둘을 분리한다.
    // 두 축은 재는 자도 다르다 — validFrom/validUntil은 서사 시간(씬 카드의 storyTime), revealFrom은
    // 서술 순서(씬 순번)로 잰다. 회상 씬은 사건 시점으로 되돌아가지만 독자가 이미 읽은 것을 되돌리지
    // 못하기 때문이다. knownBy를 적으면 그 시점에 아직 모르는 인물을 프롬프트에 표시한다.
    revealFrom: revealFromSchema.optional(),
    keywords: z.array(z.string().trim().min(1)).optional(),
  })
  // NOTE: Reject a string range bound only when it cannot resolve to a scene order; numeric
  // bounds are file-agnostic and an inverted range is left to the resolver (treated as empty).
  .superRefine((fact, ctx) => {
    for (const field of ['validFrom', 'validUntil', 'revealFrom'] as const) {
      const bound: string | number | undefined =
        field === 'revealFrom' ? revealFromScene(fact) : fact[field];
      if (typeof bound === 'string' && resolveSceneOrder(bound) === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} 은(는) 장면 순번이나 NN-slug 형식이어야 합니다.`,
        });
      }
    }
  });

export interface StoryBible {
  version: string;
  facts: BibleFact[];
}

export const storyBibleSchema: z.ZodType<StoryBible> = z.object({
  version: z.literal(storyBibleVersion),
  facts: z.array(bibleFactSchema).default([]),
});

// revealFrom은 씬 참조 하나이거나 { scene, knownBy } 객체다. 두 모양을 읽는 자리는 여러 곳이므로
// 씬 참조와 인지 목록을 꺼내는 함수를 하나씩 둔다.
export function revealFromScene(fact: BibleFact): string | number | undefined {
  const reveal = fact.revealFrom;

  if (reveal === undefined) {
    return undefined;
  }

  return typeof reveal === 'object' ? reveal.scene : reveal;
}

export function revealKnownBy(fact: BibleFact): readonly string[] | undefined {
  const reveal = fact.revealFrom;

  return typeof reveal === 'object' ? reveal.knownBy : undefined;
}

export function createEmptyBible(): StoryBible {
  return { version: storyBibleVersion, facts: [] };
}

// NOTE: id is deterministic from subject+key so re-extracting the same fact stays stable for dedup.
export function buildCandidateFact(
  subject: BibleFactSubject,
  key: string,
  value: string,
  sourceScene?: string,
): BibleFact {
  return {
    id: `${subject.kind}:${subject.id}:${key}`,
    subject,
    key,
    value,
    status: 'candidate',
    ...(sourceScene ? { sourceScene } : {}),
  };
}

// NOTE: Retrieval only injects author-confirmed canon, never auto-extracted candidates.
export function selectBibleFacts(
  bible: StoryBible,
  subjects: readonly BibleFactSubject[],
): BibleFact[] {
  if (subjects.length === 0) {
    return [];
  }

  const wanted: Set<string> = new Set(subjects.map((subject) => `${subject.kind}:${subject.id}`));

  return bible.facts.filter(
    (fact) => fact.status === 'canon' && wanted.has(`${fact.subject.kind}:${fact.subject.id}`),
  );
}

interface ResolvedFactVersion {
  readonly fact: BibleFact;
  readonly from: number;
  readonly until: number;
  readonly index: number;
}

// 씬 참조는 파일 이름으로 적히지만, 유효 구간은 사건이 벌어진 시점으로 재야 한다. 회상 씬은 순번이
// 뒤여도 사건은 앞이므로, 참조를 씬 순번으로 푼 뒤 그 씬의 서사 시간으로 바꾼다.
export function resolveStoryTime(
  sceneOrder: number,
  storyTimeline: ReadonlyMap<number, number> | undefined,
): number {
  return storyTimeline?.get(sceneOrder) ?? sceneOrder;
}

function resolveBound(
  bound: BibleFact['validFrom'],
  openValue: number,
  storyTimeline: ReadonlyMap<number, number> | undefined,
): number {
  if (bound === undefined) {
    return openValue;
  }

  const order: number | undefined = resolveSceneOrder(bound);

  return order === undefined ? openValue : resolveStoryTime(order, storyTimeline);
}

// Latest-wins: higher validFrom, then higher validUntil, then later declaration order.
function isLaterVersion(candidate: ResolvedFactVersion, current: ResolvedFactVersion): boolean {
  if (candidate.from !== current.from) {
    return candidate.from > current.from;
  }

  if (candidate.until !== current.until) {
    return candidate.until > current.until;
  }

  return candidate.index > current.index;
}

type FactActivationPredicate = (fact: BibleFact) => boolean;

// Time-aware retrieval shared by entity-membership and keyword activation. Returns the single
// canon version of each subject:key whose inclusive [validFrom, validUntil] range contains
// sceneOrder; a range-less fact is always valid, an inverted range is never valid, and overlaps
// resolve latest-wins. The activation predicate decides which facts are eligible.
function resolveValidWinners(
  bible: StoryBible,
  sceneOrder: number,
  isActivated: FactActivationPredicate,
  storyTimeline?: ReadonlyMap<number, number>,
): ResolvedFactVersion[] {
  const winners: Map<string, ResolvedFactVersion> = new Map<string, ResolvedFactVersion>();
  const sceneStoryTime: number = resolveStoryTime(sceneOrder, storyTimeline);

  bible.facts.forEach((fact, index) => {
    if (fact.status !== 'canon') {
      return;
    }

    if (!isActivated(fact)) {
      return;
    }

    const from: number = resolveBound(fact.validFrom, Number.NEGATIVE_INFINITY, storyTimeline);
    const until: number = resolveBound(fact.validUntil, Number.POSITIVE_INFINITY, storyTimeline);

    if (from > until || sceneStoryTime < from || sceneStoryTime > until) {
      return;
    }

    const groupKey: string = `${fact.subject.kind}:${fact.subject.id}:${fact.key}`;
    const candidate: ResolvedFactVersion = { fact, from, until, index };
    const current: ResolvedFactVersion | undefined = winners.get(groupKey);

    if (!current || isLaterVersion(candidate, current)) {
      winners.set(groupKey, candidate);
    }
  });

  return [...winners.values()];
}

export function selectValidBibleFacts(
  bible: StoryBible,
  subjects: readonly BibleFactSubject[],
  sceneOrder: number,
  options?: InjectionOptions,
): BibleFact[] {
  if (subjects.length === 0) {
    return [];
  }

  const wanted: Set<string> = new Set(subjects.map((subject) => `${subject.kind}:${subject.id}`));

  return resolveValidWinners(
    bible,
    sceneOrder,
    (fact) => wanted.has(`${fact.subject.kind}:${fact.subject.id}`),
    options?.storyTimeline,
  ).map((version) => version.fact);
}

export interface InjectionOptions {
  readonly budget?: number;
  // 씬 순번 → 서사 시간. 없는 씬은 순번을 그대로 쓰므로, 시간을 적지 않은 워크스페이스는 종전과 같다.
  readonly storyTimeline?: ReadonlyMap<number, number>;
}

function countKeywordHits(keywords: readonly string[] | undefined, sceneTextLower: string): number {
  if (!keywords || keywords.length === 0) {
    return 0;
  }

  const distinctKeywords: Set<string> = new Set(keywords.map((keyword) => keyword.toLowerCase()));

  let hits: number = 0;
  for (const keyword of distinctKeywords) {
    if (sceneTextLower.includes(keyword)) {
      hits += 1;
    }
  }
  return hits;
}

interface ScoredKeywordFact {
  readonly version: ResolvedFactVersion;
  readonly score: number;
}

function compareKeywordRank(first: ScoredKeywordFact, second: ScoredKeywordFact): number {
  if (first.score !== second.score) {
    return second.score - first.score;
  }

  if (first.version.index !== second.version.index) {
    return first.version.index - second.version.index;
  }

  const firstId: string = first.version.fact.id;
  const secondId: string = second.version.fact.id;
  return firstId < secondId ? -1 : firstId > secondId ? 1 : 0;
}

function applyBudget(facts: BibleFact[], budget: number | undefined): BibleFact[] {
  if (budget === undefined) {
    return facts;
  }

  const cap: number = Math.floor(budget);
  if (cap <= 0) {
    return [];
  }

  return facts.slice(0, cap);
}

// NOTE: Strict additive layer over selectValidBibleFacts. Entity-membership facts keep today's
// order and tier; keyword-activated facts (keyword substring hit + same canon/time-validity) are
// appended, deduped by id against entity facts, ranked by distinct-hit score then declaration
// order then id, and capped by an optional count budget. No keywords + no budget = today's set.
export function selectInjectedFacts(
  bible: StoryBible,
  subjects: readonly BibleFactSubject[],
  sceneText: string,
  sceneOrder: number,
  options?: InjectionOptions,
): BibleFact[] {
  // 공개 시점은 독자가 무엇을 읽었는지의 문제이므로 서술 순서(씬 순번)로 잰다. 회상 씬이라도
  // 이미 밝혀진 사실은 밝혀진 채다.
  const isRevealed = (fact: BibleFact): boolean => {
    const reveal: string | number | undefined = revealFromScene(fact);
    const revealOrder: number | undefined =
      reveal === undefined ? undefined : resolveSceneOrder(reveal);

    return revealOrder === undefined || sceneOrder >= revealOrder;
  };

  const wanted: Set<string> = new Set(subjects.map((subject) => `${subject.kind}:${subject.id}`));
  const entityWinners: ResolvedFactVersion[] = resolveValidWinners(
    bible,
    sceneOrder,
    (fact) => isRevealed(fact) && wanted.has(`${fact.subject.kind}:${fact.subject.id}`),
    options?.storyTimeline,
  );

  const sceneTextLower: string = sceneText.toLowerCase();
  const keywordWinners: ResolvedFactVersion[] = resolveValidWinners(
    bible,
    sceneOrder,
    (fact) => isRevealed(fact) && countKeywordHits(fact.keywords, sceneTextLower) > 0,
    options?.storyTimeline,
  );

  const entityIds: Set<string> = new Set(entityWinners.map((version) => version.fact.id));
  const rankedKeyword = keywordWinners
    .filter((version) => !entityIds.has(version.fact.id))
    .map((version) => ({ version, score: countKeywordHits(version.fact.keywords, sceneTextLower) }))
    .sort(compareKeywordRank)
    .map((scored) => scored.version.fact);

  const merged = [...entityWinners.map((version) => version.fact), ...rankedKeyword];

  return applyBudget(merged, options?.budget);
}
