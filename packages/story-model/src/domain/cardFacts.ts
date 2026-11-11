import type { ElementKind } from '#model/element/elementKind';
import type { Statement } from '#model/element/statement';
import {
  storyBibleVersion,
  type BibleFact,
  type BibleSubjectKind,
  type StoryBible,
} from '#model/format/bible';

export interface CardFactSource {
  readonly kind: ElementKind;
  readonly slug: string;
  readonly statements: readonly Statement[];
}

export interface CardFactLookup {
  readonly sceneOrderOf: (sceneId: string) => number | undefined;
  readonly characterSlugOf: (characterId: string) => string | undefined;
}

const firstSceneOrder: number = 1;
const unkeyedFactKey: string = 'fact';

function subjectKindOf(kind: ElementKind): BibleSubjectKind | undefined {
  return kind === 'character' || kind === 'background' ? kind : undefined;
}

function sceneOrderOrUndefined(
  sceneId: string | undefined,
  lookup: CardFactLookup,
): number | undefined {
  return sceneId === undefined ? undefined : lookup.sceneOrderOf(sceneId);
}

function revealOf(statement: Statement, lookup: CardFactLookup): BibleFact['revealFrom'] {
  const revealOrder: number | undefined = sceneOrderOrUndefined(statement.revealFrom, lookup);
  const knownBy: string[] = (statement.knownBy ?? []).flatMap((characterId) => {
    const slug: string | undefined = lookup.characterSlugOf(characterId);
    return slug === undefined ? [] : [slug];
  });

  if (knownBy.length > 0) {
    return { scene: revealOrder ?? firstSceneOrder, knownBy };
  }

  return revealOrder;
}

function projectFact(
  source: CardFactSource,
  subjectKind: BibleSubjectKind,
  statement: Statement,
  index: number,
  lookup: CardFactLookup,
): BibleFact {
  const validFrom: number | undefined = sceneOrderOrUndefined(statement.since, lookup);
  const validUntil: number | undefined = sceneOrderOrUndefined(statement.until, lookup);
  const revealFrom: BibleFact['revealFrom'] = revealOf(statement, lookup);

  return {
    id: `${subjectKind}:${source.slug}:${index}`,
    subject: { kind: subjectKind, id: source.slug },
    key: statement.key ?? unkeyedFactKey,
    value: statement.value,
    status: 'canon',
    ...(validFrom === undefined ? {} : { validFrom }),
    ...(validUntil === undefined ? {} : { validUntil }),
    ...(revealFrom === undefined ? {} : { revealFrom }),
    ...(statement.keywords === undefined ? {} : { keywords: [...statement.keywords] }),
  };
}

export function projectCardFacts(
  sources: readonly CardFactSource[],
  lookup: CardFactLookup,
): StoryBible {
  const facts: BibleFact[] = sources.flatMap((source) => {
    const subjectKind: BibleSubjectKind | undefined = subjectKindOf(source.kind);
    if (subjectKind === undefined) {
      return [];
    }

    return source.statements.flatMap((statement, index): BibleFact[] =>
      statement.facet === 'fact' ? [projectFact(source, subjectKind, statement, index, lookup)] : [],
    );
  });

  return { version: storyBibleVersion, facts };
}
