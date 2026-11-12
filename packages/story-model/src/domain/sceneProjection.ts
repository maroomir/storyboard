import type { Beat, SceneHeader } from '#model/element/scene';
import type { StatementFacetId } from '#model/element/facetCatalog';
import {
  isAuthorStatement,
  type Statement,
  type StatementSource,
} from '#model/element/statement';
import { mergeStatements } from '#model/element/statementMerge';
import { isSameStatementText } from '#model/element/statementText';
import { formatSceneNumber } from '#model/format/bundlePaths';
import { mainThreadId } from '#model/format/project';
import {
  renderSceneCardBody,
  toSceneFrontmatter,
  type SceneBeat,
  type SceneBeatDetail,
  type SceneCard,
  type SceneFile,
} from '#model/format/scene';
import type { StructureSceneEntry } from '#model/format/structure';
import type { ElementSlugLookup } from '#model/domain/cardProjection';

export interface SceneBundleContent {
  readonly header: SceneHeader;
  readonly statements: readonly Statement[];
  readonly beats: readonly Beat[];
  readonly summaryText?: string;
}

export interface ScenePlacement {
  readonly stem: string;
  readonly number: number;
  readonly entry?: StructureSceneEntry;
}

export interface SceneProjectionLookup extends ElementSlugLookup {
  readonly nameOf: (id: string) => string | undefined;
}

type SceneScalarFacet = 'purpose' | 'conflict' | 'twist' | 'emotionalShift' | 'endState';

const sceneScalarFacets: readonly SceneScalarFacet[] = [
  'purpose',
  'conflict',
  'twist',
  'emotionalShift',
  'endState',
];

const sceneListFacet: StatementFacetId = 'foreshadowing';

function slugsOf(ids: readonly string[] | undefined, lookup: ElementSlugLookup): string[] {
  return (ids ?? []).flatMap((id) => {
    const slug: string | undefined = lookup.slugOf(id);
    return slug === undefined ? [] : [slug];
  });
}

function projectBeat(beat: Beat, lookup: SceneProjectionLookup): SceneBeat {
  const cast: string[] = slugsOf(beat.cast, lookup);
  const place: string | undefined = beat.place === undefined ? undefined : lookup.nameOf(beat.place);
  const hasDetail: boolean = cast.length > 0 || place !== undefined || beat.time !== undefined;
  if (!hasDetail) {
    return { text: beat.text };
  }

  return {
    text: beat.text,
    ...(cast.length > 0 ? { cast } : {}),
    ...(place === undefined ? {} : { place }),
    ...(beat.time === undefined ? {} : { time: beat.time }),
  };
}

function scalarOf(statements: readonly Statement[], facet: StatementFacetId): string | undefined {
  return statements.find((statement) => statement.facet === facet)?.value;
}

function projectStructureFields(
  entry: StructureSceneEntry | undefined,
  lookup: ElementSlugLookup,
): Pick<SceneCard, 'thread' | 'narrator' | 'storyTime'> {
  const narrator: string | undefined =
    entry?.narrator === undefined ? undefined : lookup.slugOf(entry.narrator);

  return {
    ...(entry === undefined || entry.thread === mainThreadId ? {} : { thread: entry.thread }),
    ...(narrator === undefined ? {} : { narrator }),
    ...(entry?.storyTime === undefined ? {} : { storyTime: entry.storyTime }),
  };
}

export function projectSceneCard(
  content: SceneBundleContent,
  placement: ScenePlacement,
  lookup: SceneProjectionLookup,
): SceneCard {
  const { header, statements, beats } = content;
  const trimmedSummary: string | undefined = content.summaryText?.trim();
  const summary: string | undefined =
    trimmedSummary === undefined || trimmedSummary.length === 0 ? undefined : trimmedSummary;
  const characters: string[] = slugsOf(header.cast, lookup);
  const location: string | undefined =
    header.place === undefined ? undefined : lookup.slugOf(header.place);
  const foreshadowing: string[] = statements
    .filter((statement) => statement.facet === sceneListFacet)
    .map((statement) => statement.value);
  const scalars: Partial<Record<SceneScalarFacet, string>> = Object.fromEntries(
    sceneScalarFacets.flatMap((facet) => {
      const value: string | undefined = scalarOf(statements, facet);
      return value === undefined ? [] : [[facet, value]];
    }),
  );

  return {
    type: 'scene',
    id: placement.stem,
    title: header.title,
    ...(characters.length > 0 ? { characters } : {}),
    ...(location === undefined ? {} : { location }),
    ...projectStructureFields(placement.entry, lookup),
    ...(header.targetWordCount === undefined ? {} : { targetWordCount: header.targetWordCount }),
    ...scalars,
    ...(foreshadowing.length > 0 ? { foreshadowing } : {}),
    ...(summary === undefined ? {} : { summary }),
    ...(beats.length > 0 ? { beats: beats.map((beat) => projectBeat(beat, lookup)) } : {}),
  };
}

export function projectSceneFile(
  content: SceneBundleContent,
  placement: ScenePlacement,
  lookup: SceneProjectionLookup,
): SceneFile {
  const card: SceneCard = projectSceneCard(content, placement, lookup);

  return {
    sceneId: content.header.id,
    stem: placement.stem,
    order: placement.number,
    orderText: formatSceneNumber(placement.number),
    slug: content.header.slug,
    card,
    frontmatter: toSceneFrontmatter(card),
    body: renderSceneCardBody(card, content.summaryText),
    ...(content.summaryText === undefined ? {} : { summaryText: content.summaryText }),
  };
}

export interface SceneCastResolvers {
  readonly characterIdOf: (reference: string) => string | undefined;
  readonly placeIdOf: (reference: string) => string | undefined;
}

export interface PlanSceneBundleRequest {
  readonly current?: SceneBundleContent;
  readonly newId: string;
  readonly slug: string;
  readonly resolvers: SceneCastResolvers;
  readonly narratorIdOf: (slug: string) => string | undefined;
  readonly source: StatementSource;
}

export interface PlannedSceneBundle {
  readonly content: SceneBundleContent;
  readonly placement: Omit<StructureSceneEntry, 'scene'>;
}

function resolveIds(
  references: readonly string[] | undefined,
  resolve: (reference: string) => string | undefined,
): string[] {
  return [
    ...new Set(
      (references ?? []).flatMap((reference) => {
        const id: string | undefined = resolve(reference);
        return id === undefined ? [] : [id];
      }),
    ),
  ];
}

function planBeat(
  beat: SceneBeat,
  resolvers: SceneCastResolvers,
  scenePlaceId: string | undefined,
): Beat {
  if (typeof beat === 'string') {
    return { text: beat };
  }

  const detail: SceneBeatDetail = beat;
  const cast: string[] = resolveIds(detail.cast, resolvers.characterIdOf);
  const beatPlaceId: string | undefined =
    detail.place === undefined ? undefined : resolvers.placeIdOf(detail.place);
  const place: string | undefined = beatPlaceId === scenePlaceId ? undefined : beatPlaceId;

  return {
    text: detail.text,
    ...(cast.length > 0 ? { cast } : {}),
    ...(place === undefined ? {} : { place }),
    ...(detail.time === undefined ? {} : { time: detail.time }),
  };
}

interface DerivedSceneLine {
  readonly facet: StatementFacetId;
  readonly value: string;
}

function derivedSceneLines(card: SceneCard): DerivedSceneLine[] {
  const scalars: DerivedSceneLine[] = sceneScalarFacets.flatMap((facet) => {
    const value: string | undefined = card[facet]?.trim();
    return value === undefined || value.length === 0 ? [] : [{ facet, value }];
  });
  const foreshadowing: DerivedSceneLine[] = (card.foreshadowing ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map((value) => ({ facet: sceneListFacet, value }));

  return [...scalars, ...foreshadowing];
}

const sceneManagedFacets: ReadonlySet<StatementFacetId> = new Set<StatementFacetId>([
  ...sceneScalarFacets,
  sceneListFacet,
]);

function reconcileSceneStatements(
  current: readonly Statement[],
  derived: readonly DerivedSceneLine[],
  source: StatementSource,
): Statement[] {
  const merged: readonly Statement[] = mergeStatements(
    current,
    derived.map((line) => ({ facet: line.facet, value: line.value, source })),
  ).statements;
  const canRemoveAuthorLines: boolean = source.origin === 'author';

  return merged.filter((statement) => {
    const isStillDerived: boolean = derived.some(
      (line) => line.facet === statement.facet && isSameStatementText(line.value, statement.value),
    );
    const isProtected: boolean = isAuthorStatement(statement) && !canRemoveAuthorLines;
    return !sceneManagedFacets.has(statement.facet) || isStillDerived || isProtected;
  });
}

function inlineSummaryOf(card: SceneCard): string | undefined {
  const summary: string | undefined = card.summary?.trim();
  return summary === undefined || summary.length === 0 ? undefined : `${summary}\n`;
}

export function planSceneBundle(card: SceneCard, request: PlanSceneBundleRequest): PlannedSceneBundle {
  const { current, resolvers } = request;
  const cast: string[] = resolveIds(card.characters, resolvers.characterIdOf);
  const place: string | undefined =
    card.location === undefined ? undefined : resolvers.placeIdOf(card.location);
  const header: SceneHeader = {
    id: current?.header.id ?? request.newId,
    slug: request.slug,
    kind: 'scene',
    title: card.title ?? current?.header.title ?? request.slug,
    ...(cast.length > 0 ? { cast } : {}),
    ...(place === undefined ? {} : { place }),
    ...(current?.header.time === undefined ? {} : { time: current.header.time }),
    ...(card.targetWordCount === undefined ? {} : { targetWordCount: card.targetWordCount }),
  };
  const narrator: string | undefined =
    card.narrator === undefined ? undefined : request.narratorIdOf(card.narrator);
  const summaryText: string | undefined = inlineSummaryOf(card) ?? current?.summaryText;

  return {
    content: {
      header,
      statements: reconcileSceneStatements(current?.statements ?? [], derivedSceneLines(card), request.source),
      beats: card.beats === undefined ? [...(current?.beats ?? [])] : card.beats.map((beat) => planBeat(beat, resolvers, place)),
      ...(summaryText === undefined ? {} : { summaryText }),
    },
    placement: {
      thread: card.thread ?? mainThreadId,
      ...(narrator === undefined ? {} : { narrator }),
      ...(card.storyTime === undefined ? {} : { storyTime: card.storyTime }),
    },
  };
}
