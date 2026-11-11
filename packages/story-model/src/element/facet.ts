import type { ElementKind } from '#model/element/elementKind';

export type FacetShape = 'scalar' | 'list' | 'keyed' | 'perTarget';

export type FacetHome = 'card' | 'state';

export type FacetQualifierRule = 'required' | 'optional' | 'forbidden';

export type CardSectionId =
  | 'personality'
  | 'voice'
  | 'relations'
  | 'arc'
  | 'description'
  | 'facts'
  | 'atmosphere'
  | 'senses'
  | 'layout'
  | 'rules'
  | 'design'
  | 'foreshadowing';

export const cardSectionIds: readonly [CardSectionId, ...CardSectionId[]] = [
  'personality',
  'voice',
  'relations',
  'arc',
  'description',
  'facts',
  'atmosphere',
  'senses',
  'layout',
  'rules',
  'design',
  'foreshadowing',
];

export const cardSectionLabels: Record<CardSectionId, string> = {
  personality: '성격',
  voice: '말투',
  relations: '관계',
  arc: '변화',
  description: '묘사',
  facts: '사실',
  atmosphere: '분위기',
  senses: '감각',
  layout: '배치',
  rules: '규칙',
  design: '설계',
  foreshadowing: '복선',
};

export type FacetConsumer =
  | 'profile'
  | 'sceneDesign'
  | 'interview'
  | 'dialoguePolish'
  | 'catchphraseLimit'
  | 'manuscriptAssembly'
  | 'knowledgeBoundary';

export const promptFacetConsumers: readonly FacetConsumer[] = ['profile', 'sceneDesign'];

export interface StatementFacetRow<FacetId extends string = string> {
  readonly id: FacetId;
  readonly label: string;
  readonly shape: FacetShape;
  readonly kinds: readonly ElementKind[];
  readonly section: CardSectionId;
  readonly key: FacetQualifierRule;
  readonly about: FacetQualifierRule;
  readonly consumers: readonly FacetConsumer[];
}

export interface ElementDefinition<FacetId extends string> {
  readonly kind: ElementKind;
  readonly sections: readonly CardSectionId[];
  readonly facets: readonly StatementFacetRow<FacetId>[];
}

export function isSingleValuedShape(shape: FacetShape): boolean {
  return shape !== 'list';
}
