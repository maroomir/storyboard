import { z } from 'zod';

import { resolveSceneOrder } from './scene';

export const storyBibleVersion: string = '1.0.0';

export type BibleFactStatus = 'canon' | 'candidate';

export const bibleFactStatuses: readonly [BibleFactStatus, ...BibleFactStatus[]] = [
  'canon',
  'candidate',
];

export type BibleSubjectKind = 'character' | 'background';

export const bibleSubjectKinds: readonly [BibleSubjectKind, ...BibleSubjectKind[]] = [
  'character',
  'background',
];

export interface BibleFactSubject {
  kind: BibleSubjectKind;
  id: string;
}

export const bibleFactSubjectSchema: z.ZodType<BibleFactSubject> = z.object({
  kind: z.enum(bibleSubjectKinds),
  id: z.string().trim().min(1),
});

const sceneReferenceSchema: z.ZodType<string | number> = z.union([
  z.string().trim().min(1),
  z.number().int().positive(),
]);

type RevealFrom = string | number | { scene: string | number; knownBy?: string[] };

const revealFromSchema: z.ZodType<RevealFrom> = z.union([
  sceneReferenceSchema,
  z.object({
    scene: sceneReferenceSchema,
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
    revealFrom: revealFromSchema.optional(),
    keywords: z.array(z.string().trim().min(1)).optional(),
  })
  .superRefine((fact, refinement) => {
    for (const field of ['validFrom', 'validUntil', 'revealFrom'] as const) {
      const bound: string | number | undefined =
        field === 'revealFrom' ? revealFromScene(fact) : fact[field];
      if (typeof bound === 'string' && resolveSceneOrder(bound) === undefined) {
        refinement.addIssue({
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

export function revealFromScene(fact: BibleFact): string | number | undefined {
  const reveal: BibleFact['revealFrom'] = fact.revealFrom;

  if (reveal === undefined) {
    return undefined;
  }

  return typeof reveal === 'object' ? reveal.scene : reveal;
}

export function revealKnownBy(fact: BibleFact): readonly string[] | undefined {
  const reveal: BibleFact['revealFrom'] = fact.revealFrom;

  return typeof reveal === 'object' ? reveal.knownBy : undefined;
}

export function createEmptyBible(): StoryBible {
  return { version: storyBibleVersion, facts: [] };
}

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

export function selectInjectedFacts(
  bible: StoryBible,
  subjects: readonly BibleFactSubject[],
  sceneText: string,
  sceneOrder: number,
  options?: InjectionOptions,
): BibleFact[] {
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
  const rankedKeyword: BibleFact[] = keywordWinners
    .filter((version) => !entityIds.has(version.fact.id))
    .map((version) => ({ version, score: countKeywordHits(version.fact.keywords, sceneTextLower) }))
    .sort(compareKeywordRank)
    .map((scored) => scored.version.fact);

  const merged: BibleFact[] = [...entityWinners.map((version) => version.fact), ...rankedKeyword];

  return applyBudget(merged, options?.budget);
}
