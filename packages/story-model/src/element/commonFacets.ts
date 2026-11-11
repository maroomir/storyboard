import type { StatementFacetRow } from '#model/element/facet';

export type CommonFacetId = 'description' | 'voice' | 'fact';

export const commonFacetRows: readonly StatementFacetRow<CommonFacetId>[] = [
  {
    id: 'description',
    label: '묘사',
    shape: 'list',
    kinds: ['character', 'background', 'narrator'],
    section: 'description',
    key: 'forbidden',
    about: 'forbidden',
    consumers: ['profile', 'interview'],
  },
  {
    id: 'voice',
    label: '말투',
    shape: 'list',
    kinds: ['character', 'narrator'],
    section: 'voice',
    key: 'forbidden',
    about: 'forbidden',
    consumers: ['profile', 'interview', 'dialoguePolish'],
  },
  {
    id: 'fact',
    label: '사실',
    shape: 'keyed',
    kinds: ['character', 'background', 'narrator'],
    section: 'facts',
    key: 'optional',
    about: 'optional',
    consumers: ['profile', 'knowledgeBoundary'],
  },
];
