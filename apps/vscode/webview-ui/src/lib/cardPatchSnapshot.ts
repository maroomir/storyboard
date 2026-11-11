import {
  cardSectionLabels,
  getStatementFacetRow,
  isStatementFacetId,
  type StudioCardFieldChange,
  type StudioCardFieldValue,
} from '@storyboard/story-model/contracts';

export interface CardPatchSnapshotLine {
  readonly label: string;
  readonly text: string;
}

const projectedFieldFacets: Readonly<Record<string, string>> = {
  relations: 'relation',
};

function labelOfField(field: string): string {
  const facet: string = projectedFieldFacets[field] ?? field;

  return isStatementFacetId(facet) ? cardSectionLabels[getStatementFacetRow(facet).section] : field;
}

function textsOfValue(value: StudioCardFieldValue): readonly string[] {
  if (typeof value === 'string') {
    return [value];
  }

  return value.map((item) =>
    typeof item === 'string' ? item : Object.values(item).filter(Boolean).join(' · '),
  );
}

export function describeCardPatchSnapshot(
  changes: readonly StudioCardFieldChange[],
): readonly CardPatchSnapshotLine[] {
  return changes.flatMap((change) =>
    textsOfValue(change.value).map((text) => ({ label: labelOfField(change.field), text })),
  );
}
