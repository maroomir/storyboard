import type { ElementDefinition } from '#model/element/facet';

export type SceneFacetId =
  | 'purpose'
  | 'conflict'
  | 'twist'
  | 'emotionalShift'
  | 'endState'
  | 'foreshadowing';

export const sceneElement: ElementDefinition<SceneFacetId> = {
  kind: 'scene',
  sections: ['design', 'foreshadowing'],
  facets: [
    {
      id: 'purpose',
      label: '목적',
      shape: 'scalar',
      kinds: ['scene'],
      section: 'design',
      key: 'forbidden',
      about: 'forbidden',
      consumers: ['sceneDesign'],
    },
    {
      id: 'conflict',
      label: '갈등',
      shape: 'scalar',
      kinds: ['scene'],
      section: 'design',
      key: 'forbidden',
      about: 'forbidden',
      consumers: ['sceneDesign'],
    },
    {
      id: 'twist',
      label: '반전',
      shape: 'scalar',
      kinds: ['scene'],
      section: 'design',
      key: 'forbidden',
      about: 'forbidden',
      consumers: ['sceneDesign'],
    },
    {
      id: 'emotionalShift',
      label: '감정 변화',
      shape: 'scalar',
      kinds: ['scene'],
      section: 'design',
      key: 'forbidden',
      about: 'forbidden',
      consumers: ['sceneDesign'],
    },
    {
      id: 'endState',
      label: '종료 지점',
      shape: 'scalar',
      kinds: ['scene'],
      section: 'design',
      key: 'forbidden',
      about: 'forbidden',
      consumers: ['sceneDesign'],
    },
    {
      id: 'foreshadowing',
      label: '회수할 복선',
      shape: 'list',
      kinds: ['scene'],
      section: 'foreshadowing',
      key: 'forbidden',
      about: 'forbidden',
      consumers: ['sceneDesign', 'manuscriptAssembly'],
    },
  ],
};
