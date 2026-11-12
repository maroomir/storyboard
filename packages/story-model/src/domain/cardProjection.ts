import type { BackgroundHeader } from '#model/element/background';
import type { CharacterAttributes, CharacterHeader } from '#model/element/character';
import { characterAttributeKeys } from '#model/element/character';
import type { ElementKind } from '#model/element/elementKind';
import { getStatementFacetRow, type StatementFacetId } from '#model/element/facetCatalog';
import type { NarratorHeader } from '#model/element/narrator';
import {
  isAuthorStatement,
  type Statement,
  type StatementSource,
} from '#model/element/statement';
import { mergeStatements } from '#model/element/statementMerge';
import { isSameStatementText } from '#model/element/statementText';
import type {
  CharacterArc,
  CharacterCard,
  CharacterRelation,
  LocationBackgroundCard,
} from '#model/format/card';
import type { NarratorCard } from '#model/format/narrator';

export interface ElementSlugLookup {
  readonly slugOf: (id: string) => string | undefined;
  readonly idOf: (kind: ElementKind, slug: string) => string | undefined;
}

export interface ElementBundleContent<THeader> {
  readonly header: THeader;
  readonly statements: readonly Statement[];
}

export interface PlanBundleRequest<THeader> {
  readonly current?: ElementBundleContent<THeader>;
  readonly newId: string;
  readonly lookup: ElementSlugLookup;
  readonly source: StatementSource;
}

type CharacterListFacet = 'traits' | 'description' | 'voice' | 'catchphrases' | 'desire';

const characterListFacets: readonly CharacterListFacet[] = [
  'traits',
  'description',
  'voice',
  'catchphrases',
  'desire',
];

type BackgroundListFacet = 'description' | 'tags' | 'senses' | 'layout' | 'rules';

const backgroundListFacets: readonly BackgroundListFacet[] = [
  'description',
  'tags',
  'senses',
  'layout',
  'rules',
];

type BackgroundScalarFacet = 'time' | 'weather';

const backgroundScalarFacets: readonly BackgroundScalarFacet[] = ['time', 'weather'];

type NarratorListFacet = 'description' | 'voice';

const narratorListFacets: readonly NarratorListFacet[] = ['description', 'voice'];

function listValuesOf(statements: readonly Statement[], facet: StatementFacetId): string[] {
  return statements.filter((statement) => statement.facet === facet).map((item) => item.value);
}

function optionalList(values: readonly string[]): string[] | undefined {
  return values.length > 0 ? [...values] : undefined;
}

function scalarValueOf(
  statements: readonly Statement[],
  facet: StatementFacetId,
): string | undefined {
  return statements.find((statement) => statement.facet === facet)?.value;
}

function projectRelations(
  statements: readonly Statement[],
  lookup: ElementSlugLookup,
): CharacterRelation[] {
  const relationsByTarget: Map<string, CharacterRelation> = new Map();

  for (const statement of statements) {
    const isRelationLine: boolean = statement.facet === 'relation' || statement.facet === 'speech';
    const target: string | undefined =
      isRelationLine && statement.about !== undefined ? lookup.slugOf(statement.about) : undefined;
    if (target === undefined) {
      continue;
    }

    const relation: CharacterRelation = relationsByTarget.get(target) ?? { target, type: '' };
    relationsByTarget.set(
      target,
      statement.facet === 'relation'
        ? { ...relation, type: statement.value }
        : { ...relation, speech: statement.value },
    );
  }

  return [...relationsByTarget.values()];
}

function projectAttributes(
  attributes: CharacterAttributes | undefined,
): CharacterCard['attributes'] {
  if (attributes === undefined) {
    return undefined;
  }

  const entries: [string, string | number][] = characterAttributeKeys.flatMap((key) => {
    const value: string | number | undefined = attributes[key];
    return value === undefined ? [] : [[key, value]];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function projectCharacterCard(
  content: ElementBundleContent<CharacterHeader>,
  lookup: ElementSlugLookup,
): CharacterCard {
  const { header, statements } = content;
  const relations: CharacterRelation[] = projectRelations(statements, lookup);
  const arcSummary: string | undefined = scalarValueOf(statements, 'arc');
  const attributes: CharacterCard['attributes'] = projectAttributes(header.attributes);
  const listFields: Partial<Record<CharacterListFacet, string[]>> = Object.fromEntries(
    characterListFacets.flatMap((facet) => {
      const values: string[] | undefined = optionalList(listValuesOf(statements, facet));
      return values === undefined ? [] : [[facet, values]];
    }),
  );

  return {
    type: 'character',
    id: header.slug,
    name: header.name,
    ...(header.role === undefined ? {} : { role: header.role }),
    ...(attributes === undefined ? {} : { attributes }),
    ...(header.aliases === undefined ? {} : { aliases: [...header.aliases] }),
    ...listFields,
    ...(relations.length > 0 ? { relations } : {}),
    ...(arcSummary === undefined
      ? {}
      : { arc: [{ stage: getStatementFacetRow('arc').label, summary: arcSummary }] }),
  };
}

export function projectBackgroundCard(
  content: ElementBundleContent<BackgroundHeader>,
): LocationBackgroundCard {
  const { header, statements } = content;
  const time: string | undefined = scalarValueOf(statements, 'time');
  const weather: string | undefined = scalarValueOf(statements, 'weather');
  const senses: string[] | undefined = optionalList(listValuesOf(statements, 'senses'));
  const layout: string[] | undefined = optionalList(listValuesOf(statements, 'layout'));
  const rules: string[] | undefined = optionalList(listValuesOf(statements, 'rules'));

  return {
    type: 'location',
    locationKind: 'place',
    id: header.slug,
    name: header.name,
    ...(header.aliases === undefined ? {} : { aliases: [...header.aliases] }),
    description: listValuesOf(statements, 'description'),
    characterIds: [],
    tags: listValuesOf(statements, 'tags'),
    ...(time === undefined ? {} : { time }),
    ...(weather === undefined ? {} : { weather }),
    ...(senses === undefined ? {} : { senses }),
    ...(layout === undefined ? {} : { layout }),
    ...(rules === undefined ? {} : { rules }),
  };
}

export function projectNarratorCard(
  content: ElementBundleContent<NarratorHeader>,
  lookup: ElementSlugLookup,
): NarratorCard {
  const { header, statements } = content;
  const focal: string | undefined =
    header.focal === undefined ? undefined : lookup.slugOf(header.focal);
  const description: string[] | undefined = optionalList(listValuesOf(statements, 'description'));
  const voice: string[] | undefined = optionalList(listValuesOf(statements, 'voice'));

  return {
    type: 'narrator',
    id: header.slug,
    name: header.name,
    person: header.person,
    knowledge: header.knowledge,
    ...(header.tense === undefined ? {} : { tense: header.tense }),
    ...(focal === undefined ? {} : { focal }),
    ...(description === undefined ? {} : { description }),
    ...(voice === undefined ? {} : { voice }),
  };
}

interface DerivedLine {
  readonly facet: StatementFacetId;
  readonly value: string;
  readonly about?: string;
  readonly key?: string;
}

function toStatement(line: DerivedLine, source: StatementSource): Statement {
  return {
    facet: line.facet,
    ...(line.key === undefined ? {} : { key: line.key }),
    ...(line.about === undefined ? {} : { about: line.about }),
    value: line.value,
    source,
  };
}

function isLineOfStatement(line: DerivedLine, statement: Statement): boolean {
  return (
    line.facet === statement.facet &&
    line.about === statement.about &&
    line.key === statement.key &&
    isSameStatementText(line.value, statement.value)
  );
}

function reconcileStatements(
  current: readonly Statement[],
  derived: readonly DerivedLine[],
  managedFacets: ReadonlySet<StatementFacetId>,
  source: StatementSource,
): Statement[] {
  const merged: readonly Statement[] = mergeStatements(
    current,
    derived.map((line) => toStatement(line, source)),
  ).statements;
  const canRemoveAuthorLines: boolean = source.origin === 'author';

  return merged.filter((statement) => {
    const isManaged: boolean = managedFacets.has(statement.facet);
    const isStillDerived: boolean = derived.some((line) => isLineOfStatement(line, statement));
    const isProtected: boolean = isAuthorStatement(statement) && !canRemoveAuthorLines;
    return !isManaged || isStillDerived || isProtected;
  });
}

function listLines(facet: StatementFacetId, values: readonly string[] | undefined): DerivedLine[] {
  return (values ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map((value) => ({ facet, value }));
}

function scalarLines(facet: StatementFacetId, value: string | undefined): DerivedLine[] {
  const trimmed: string | undefined = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? [] : [{ facet, value: trimmed }];
}

function relationLines(
  relations: readonly CharacterRelation[] | undefined,
  lookup: ElementSlugLookup,
): DerivedLine[] {
  return (relations ?? []).flatMap((relation) => {
    const about: string | undefined = lookup.idOf('character', relation.target);
    if (about === undefined) {
      return [];
    }

    return [
      ...scalarLines('relation', relation.type).map((line) => ({ ...line, about })),
      ...scalarLines('speech', relation.speech).map((line) => ({ ...line, about })),
    ];
  });
}

function lastArcSummary(arc: readonly CharacterArc[] | undefined): string | undefined {
  return arc === undefined || arc.length === 0 ? undefined : arc[arc.length - 1]?.summary;
}

function splitAttributes(attributes: CharacterCard['attributes']): {
  readonly header: CharacterAttributes | undefined;
  readonly facts: DerivedLine[];
} {
  const headerEntries: [string, string | number][] = [];
  const facts: DerivedLine[] = [];

  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (value === null || value === undefined || String(value).trim().length === 0) {
      continue;
    }

    const isHeaderKey: boolean = (characterAttributeKeys as readonly string[]).includes(key);
    const headerValue: string | number = typeof value === 'number' ? value : String(value).trim();
    if (isHeaderKey) {
      headerEntries.push([key, headerValue]);
    } else {
      facts.push({ facet: 'fact', key, value: String(value).trim() });
    }
  }

  return {
    header: headerEntries.length > 0 ? Object.fromEntries(headerEntries) : undefined,
    facts,
  };
}

const characterManagedFacets: ReadonlySet<StatementFacetId> = new Set<StatementFacetId>([
  ...characterListFacets,
  'relation',
  'speech',
  'arc',
]);

export function planCharacterBundle(
  card: CharacterCard,
  request: PlanBundleRequest<CharacterHeader>,
): ElementBundleContent<CharacterHeader> {
  const attributes: ReturnType<typeof splitAttributes> = splitAttributes(card.attributes);
  const header: CharacterHeader = {
    id: request.current?.header.id ?? request.newId,
    slug: card.id,
    kind: 'character',
    name: card.name,
    ...(card.role === undefined ? {} : { role: card.role }),
    ...(attributes.header === undefined ? {} : { attributes: attributes.header }),
    ...(card.aliases === undefined || card.aliases.length === 0
      ? {}
      : { aliases: [...card.aliases] }),
  };
  const derived: DerivedLine[] = [
    ...characterListFacets.flatMap((facet) => listLines(facet, card[facet])),
    ...relationLines(card.relations, request.lookup),
    ...scalarLines('arc', lastArcSummary(card.arc)),
    ...attributes.facts,
  ];

  return {
    header,
    statements: reconcileStatements(
      request.current?.statements ?? [],
      derived,
      characterManagedFacets,
      request.source,
    ),
  };
}

const backgroundManagedFacets: ReadonlySet<StatementFacetId> = new Set<StatementFacetId>([
  ...backgroundListFacets,
  ...backgroundScalarFacets,
]);

export function planBackgroundBundle(
  card: Pick<
    LocationBackgroundCard,
    'id' | 'name' | 'aliases' | 'description' | 'tags' | 'time' | 'weather' | 'senses' | 'layout' | 'rules'
  >,
  request: PlanBundleRequest<BackgroundHeader>,
): ElementBundleContent<BackgroundHeader> {
  const header: BackgroundHeader = {
    id: request.current?.header.id ?? request.newId,
    slug: card.id,
    kind: 'background',
    name: card.name,
    ...(card.aliases === undefined || card.aliases.length === 0
      ? {}
      : { aliases: [...card.aliases] }),
    ...(request.current?.header.within === undefined
      ? {}
      : { within: request.current.header.within }),
  };
  const derived: DerivedLine[] = [
    ...backgroundListFacets.flatMap((facet) => listLines(facet, card[facet])),
    ...backgroundScalarFacets.flatMap((facet) => scalarLines(facet, card[facet])),
  ];

  return {
    header,
    statements: reconcileStatements(
      request.current?.statements ?? [],
      derived,
      backgroundManagedFacets,
      request.source,
    ),
  };
}

const narratorManagedFacets: ReadonlySet<StatementFacetId> = new Set<StatementFacetId>(
  narratorListFacets,
);

export function planNarratorBundle(
  card: NarratorCard,
  request: PlanBundleRequest<NarratorHeader>,
): ElementBundleContent<NarratorHeader> {
  const focal: string | undefined =
    card.focal === undefined ? undefined : request.lookup.idOf('character', card.focal);
  const header: NarratorHeader = {
    id: request.current?.header.id ?? request.newId,
    slug: card.id,
    kind: 'narrator',
    name: card.name,
    person: card.person,
    knowledge: card.knowledge,
    ...(card.tense === undefined ? {} : { tense: card.tense }),
    ...(focal === undefined ? {} : { focal }),
  };

  return {
    header,
    statements: reconcileStatements(
      request.current?.statements ?? [],
      narratorListFacets.flatMap((facet) => listLines(facet, card[facet])),
      narratorManagedFacets,
      request.source,
    ),
  };
}
