import { resolveSceneOrder } from '#model/format/scene';

export const storyBibleVersion: string = '1.0.0';

export type BibleFactStatus = 'canon' | 'candidate';

export type BibleSubjectKind = 'character' | 'background';

export const bibleSubjectKinds: readonly [BibleSubjectKind, ...BibleSubjectKind[]] = [
  'character',
  'background',
];

export interface BibleFactSubject {
  kind: BibleSubjectKind;
  id: string;
}

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

export interface StoryBible {
  version: string;
  facts: BibleFact[];
}

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
