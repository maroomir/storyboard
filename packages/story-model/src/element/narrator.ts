import type { ElementDefinition } from '#model/element/facet';

export const narratorElement: ElementDefinition<never> = {
  kind: 'narrator',
  sections: ['voice', 'description', 'facts'],
  facets: [],
};
