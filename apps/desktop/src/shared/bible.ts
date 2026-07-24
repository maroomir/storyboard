import { z } from 'zod';

import { resolveSceneOrder } from './scene';

export const storyBibleVersion = '1.0.0';

export const bibleFactStatuses = ['canon', 'candidate'] as const;
export type BibleFactStatus = (typeof bibleFactStatuses)[number];

export const bibleSubjectKinds = ['character', 'background'] as const;
export type BibleSubjectKind = (typeof bibleSubjectKinds)[number];

export const bibleFactSubjectSchema = z.object({
  kind: z.enum(bibleSubjectKinds),
  id: z.string().trim().min(1),
});

// A scene reference is an `NN-slug` stem or a bare order; both resolve to a numeric scene order.
const sceneReferenceSchema = z.union([z.string().trim().min(1), z.number().int().positive()]);

export const bibleFactSchema = z
  .object({
    id: z.string().trim().min(1),
    subject: bibleFactSubjectSchema,
    key: z.string().trim().min(1),
    value: z.string().trim().min(1),
    status: z.enum(bibleFactStatuses).default('canon'),
    sourceScene: z.string().trim().min(1).optional(),
    validFrom: sceneReferenceSchema.optional(),
    validUntil: sceneReferenceSchema.optional(),
    keywords: z.array(z.string().trim().min(1)).optional(),
  })
  // NOTE: Reject a string range bound only when it cannot resolve to a scene order; numeric
  // bounds are file-agnostic and an inverted range is left to the resolver (treated as empty).
  .superRefine((fact, ctx) => {
    for (const field of ['validFrom', 'validUntil'] as const) {
      const bound = fact[field];
      if (typeof bound === 'string' && resolveSceneOrder(bound) === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} 은(는) 장면 순번이나 NN-slug 형식이어야 합니다.`,
        });
      }
    }
  });

export const storyBibleSchema = z.object({
  version: z.literal(storyBibleVersion),
  facts: z.array(bibleFactSchema).default([]),
});

export type BibleFactSubject = z.infer<typeof bibleFactSubjectSchema>;
export type BibleFact = z.infer<typeof bibleFactSchema>;
export type StoryBible = z.infer<typeof storyBibleSchema>;

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

  const wanted = new Set(subjects.map((subject) => `${subject.kind}:${subject.id}`));

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

function resolveBound(bound: BibleFact['validFrom'], openValue: number): number {
  if (bound === undefined) {
    return openValue;
  }

  return resolveSceneOrder(bound) ?? openValue;
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
): ResolvedFactVersion[] {
  const winners = new Map<string, ResolvedFactVersion>();

  bible.facts.forEach((fact, index) => {
    if (fact.status !== 'canon') {
      return;
    }

    if (!isActivated(fact)) {
      return;
    }

    const from = resolveBound(fact.validFrom, Number.NEGATIVE_INFINITY);
    const until = resolveBound(fact.validUntil, Number.POSITIVE_INFINITY);

    if (from > until || sceneOrder < from || sceneOrder > until) {
      return;
    }

    const groupKey = `${fact.subject.kind}:${fact.subject.id}:${fact.key}`;
    const candidate: ResolvedFactVersion = { fact, from, until, index };
    const current = winners.get(groupKey);

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
): BibleFact[] {
  if (subjects.length === 0) {
    return [];
  }

  const wanted = new Set(subjects.map((subject) => `${subject.kind}:${subject.id}`));

  return resolveValidWinners(bible, sceneOrder, (fact) =>
    wanted.has(`${fact.subject.kind}:${fact.subject.id}`),
  ).map((version) => version.fact);
}

export interface InjectionOptions {
  readonly budget?: number;
}

function countKeywordHits(keywords: readonly string[] | undefined, sceneTextLower: string): number {
  if (!keywords || keywords.length === 0) {
    return 0;
  }

  const distinctKeywords = new Set(keywords.map((keyword) => keyword.toLowerCase()));

  let hits = 0;
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

  const firstId = first.version.fact.id;
  const secondId = second.version.fact.id;
  return firstId < secondId ? -1 : firstId > secondId ? 1 : 0;
}

function applyBudget(facts: BibleFact[], budget: number | undefined): BibleFact[] {
  if (budget === undefined) {
    return facts;
  }

  const cap = Math.floor(budget);
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
  const wanted = new Set(subjects.map((subject) => `${subject.kind}:${subject.id}`));
  const entityWinners = resolveValidWinners(bible, sceneOrder, (fact) =>
    wanted.has(`${fact.subject.kind}:${fact.subject.id}`),
  );

  const sceneTextLower = sceneText.toLowerCase();
  const keywordWinners = resolveValidWinners(
    bible,
    sceneOrder,
    (fact) => countKeywordHits(fact.keywords, sceneTextLower) > 0,
  );

  const entityIds = new Set(entityWinners.map((version) => version.fact.id));
  const rankedKeyword = keywordWinners
    .filter((version) => !entityIds.has(version.fact.id))
    .map((version) => ({ version, score: countKeywordHits(version.fact.keywords, sceneTextLower) }))
    .sort(compareKeywordRank)
    .map((scored) => scored.version.fact);

  const merged = [...entityWinners.map((version) => version.fact), ...rankedKeyword];

  return applyBudget(merged, options?.budget);
}
