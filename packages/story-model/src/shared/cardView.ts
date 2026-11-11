import { characterRoleLabels, type CharacterHeader } from '#model/element/character';
import type { BackgroundHeader } from '#model/element/background';
import { getElementDisplayName, type ElementHeader } from '#model/element/elementHeader';
import type { ElementKind } from '#model/element/elementKind';
import { cardSectionLabels, type CardSectionId } from '#model/element/facet';
import { elementDefinitions, getStatementFacetRow } from '#model/element/facetCatalog';
import {
  narrativeTenseLabels,
  narratorKnowledgeLabels,
  narratorPersonLabels,
  type NarratorHeader,
} from '#model/element/narrator';
import type { SceneHeader } from '#model/element/scene';
import type { Statement } from '#model/element/statement';

export interface CardViewLine {
  readonly text: string;
  readonly label?: string;
}

export interface CardViewSection {
  readonly id: CardSectionId;
  readonly label: string;
  readonly lines: readonly CardViewLine[];
}

export interface CardView {
  readonly kind: ElementKind;
  readonly slug: string;
  readonly name: string;
  readonly facts: readonly string[];
  readonly sections: readonly CardViewSection[];
}

export interface CardViewBundle {
  readonly header: ElementHeader;
  readonly statements: readonly Statement[];
}

export interface CardViewLookup {
  readonly nameOf: (elementId: string) => string | undefined;
}

function describeCharacter(header: CharacterHeader): readonly string[] {
  const age: string | number | undefined = header.attributes?.age;

  return [
    header.role === undefined ? undefined : characterRoleLabels[header.role],
    age === undefined ? undefined : typeof age === 'number' ? `${age}세` : age,
    header.attributes?.sex,
    header.attributes?.job,
    header.aliases === undefined ? undefined : `별칭 ${header.aliases.join(', ')}`,
  ].filter((fact): fact is string => fact !== undefined);
}

function describeBackground(header: BackgroundHeader, lookup: CardViewLookup): readonly string[] {
  const within: string | undefined =
    header.within === undefined ? undefined : lookup.nameOf(header.within);

  return [
    within === undefined ? undefined : `${within} 안`,
    header.aliases === undefined ? undefined : `별칭 ${header.aliases.join(', ')}`,
  ].filter((fact): fact is string => fact !== undefined);
}

function describeNarrator(header: NarratorHeader, lookup: CardViewLookup): readonly string[] {
  const focal: string | undefined =
    header.focal === undefined ? undefined : lookup.nameOf(header.focal);

  return [
    narratorPersonLabels[header.person],
    narratorKnowledgeLabels[header.knowledge],
    header.tense === undefined ? undefined : narrativeTenseLabels[header.tense],
    focal === undefined ? undefined : `초점 ${focal}`,
  ].filter((fact): fact is string => fact !== undefined);
}

function describeScene(header: SceneHeader, lookup: CardViewLookup): readonly string[] {
  const place: string | undefined =
    header.place === undefined ? undefined : lookup.nameOf(header.place);
  const cast: readonly string[] = (header.cast ?? []).map(
    (elementId) => lookup.nameOf(elementId) ?? elementId,
  );

  return [
    place,
    header.time,
    cast.length === 0 ? undefined : `출연 ${cast.join(', ')}`,
    header.targetWordCount === undefined ? undefined : `${header.targetWordCount}자`,
  ].filter((fact): fact is string => fact !== undefined);
}

function describeHeader(header: ElementHeader, lookup: CardViewLookup): readonly string[] {
  switch (header.kind) {
    case 'character':
      return describeCharacter(header);
    case 'background':
      return describeBackground(header, lookup);
    case 'narrator':
      return describeNarrator(header, lookup);
    case 'scene':
      return describeScene(header, lookup);
  }
}

function toViewLine(statement: Statement, lookup: CardViewLookup): CardViewLine {
  const about: string | undefined =
    statement.about === undefined
      ? undefined
      : (lookup.nameOf(statement.about) ?? statement.about);
  const label: string | undefined = about ?? statement.key;

  return label === undefined ? { text: statement.value } : { text: statement.value, label };
}

export function groupStatementsBySection(
  kind: ElementKind,
  statements: readonly Statement[],
  lookup: CardViewLookup,
): readonly CardViewSection[] {
  return elementDefinitions[kind].sections.map((sectionId) => ({
    id: sectionId,
    label: cardSectionLabels[sectionId],
    lines: statements
      .filter((statement) => getStatementFacetRow(statement.facet).section === sectionId)
      .map((statement) => toViewLine(statement, lookup)),
  }));
}

export function buildCardView(bundle: CardViewBundle, lookup: CardViewLookup): CardView {
  const { header, statements } = bundle;

  return {
    kind: header.kind,
    slug: header.slug,
    name: getElementDisplayName(header),
    facts: describeHeader(header, lookup),
    sections: groupStatementsBySection(header.kind, statements, lookup),
  };
}
