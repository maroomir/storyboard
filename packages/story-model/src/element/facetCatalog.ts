import { backgroundElement, type BackgroundFacetId } from '#model/element/background';
import { characterElement, type CharacterFacetId } from '#model/element/character';
import { commonFacetRows, type CommonFacetId } from '#model/element/commonFacets';
import type { ElementKind } from '#model/element/elementKind';
import type { CardSectionId, ElementDefinition, StatementFacetRow } from '#model/element/facet';
import { narratorElement } from '#model/element/narrator';
import { sceneElement, type SceneFacetId } from '#model/element/scene';

export type StatementFacetId = CommonFacetId | CharacterFacetId | BackgroundFacetId | SceneFacetId;

export const elementDefinitions: Record<ElementKind, ElementDefinition<StatementFacetId>> = {
  character: characterElement,
  background: backgroundElement,
  scene: sceneElement,
  narrator: narratorElement,
};

export const statementFacetCatalog: readonly StatementFacetRow<StatementFacetId>[] = [
  ...commonFacetRows,
  ...characterElement.facets,
  ...backgroundElement.facets,
  ...sceneElement.facets,
];

export function isStatementFacetId(value: string): value is StatementFacetId {
  return statementFacetCatalog.some((row) => row.id === value);
}

const statementFacetRowsById: Record<StatementFacetId, StatementFacetRow<StatementFacetId>> =
  Object.fromEntries(statementFacetCatalog.map((row) => [row.id, row])) as Record<
    StatementFacetId,
    StatementFacetRow<StatementFacetId>
  >;

export function getStatementFacetRow(facetId: StatementFacetId): StatementFacetRow<StatementFacetId> {
  return statementFacetRowsById[facetId];
}

export function listStatementFacetsOf(kind: ElementKind): readonly StatementFacetRow<StatementFacetId>[] {
  return statementFacetCatalog.filter((row) => row.kinds.includes(kind));
}

export function isStatementFacetOf(facetId: StatementFacetId, kind: ElementKind): boolean {
  return getStatementFacetRow(facetId).kinds.includes(kind);
}

export function listSectionFacets(
  kind: ElementKind,
  section: CardSectionId,
): readonly StatementFacetRow<StatementFacetId>[] {
  return listStatementFacetsOf(kind).filter((row) => row.section === section);
}
