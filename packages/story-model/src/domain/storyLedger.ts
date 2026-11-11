import type { StoryStateStatement } from '#model/element/statement';
import type { StoryStateFacetId } from '#model/element/storyStateFacets';
import type { SceneStoryState } from '#model/format/bundleFiles';
import type { StoryState, StoryStateEntry, StoryStateSection } from '#model/format/storyState';

export interface LedgerSceneState {
  readonly order: number;
  readonly state?: SceneStoryState;
}

export interface StoryLedgerLookup {
  readonly characterSlugOf: (characterId: string) => string | undefined;
  readonly characterIdOf: (characterSlug: string) => string | undefined;
}

const sectionByFacet: Readonly<Record<StoryStateFacetId, StoryStateSection>> = {
  event: 'facts',
  fact: 'facts',
  relationShift: 'relations',
  reveal: 'revealed',
  motif: 'motifs',
};

const facetBySection: Readonly<Record<StoryStateSection, StoryStateFacetId>> = {
  facts: 'event',
  relations: 'relationShift',
  revealed: 'reveal',
  motifs: 'motif',
};

function resolveAll(
  references: readonly string[] | undefined,
  resolve: (reference: string) => string | undefined,
): string[] {
  return (references ?? []).flatMap((reference) => {
    const resolved: string | undefined = resolve(reference);
    return resolved === undefined ? [] : [resolved];
  });
}

function toEntry(
  statement: StoryStateStatement,
  scene: LedgerSceneState,
  lookup: StoryLedgerLookup,
): StoryStateEntry {
  const witnesses: string[] = resolveAll(statement.knownBy, lookup.characterSlugOf);

  return {
    section: sectionByFacet[statement.facet],
    text: statement.value,
    throughScene: scene.order,
    ...(scene.state?.stale === true ? { isStale: true } : {}),
    ...(witnesses.length > 0 ? { witnesses } : {}),
  };
}

function toStatement(entry: StoryStateEntry, lookup: StoryLedgerLookup): StoryStateStatement {
  const knownBy: string[] = resolveAll(entry.witnesses, lookup.characterIdOf);

  return {
    facet: facetBySection[entry.section],
    value: entry.text,
    ...(knownBy.length > 0 ? { knownBy } : {}),
  };
}

export function composeStoryState(
  scenes: readonly LedgerSceneState[],
  lookup: StoryLedgerLookup,
): StoryState {
  const recorded: readonly LedgerSceneState[] = scenes.filter((scene) => scene.state !== undefined);

  return {
    throughSceneOrder: Math.max(0, ...recorded.map((scene) => scene.order)),
    sceneInputHashes: new Map(
      recorded.flatMap((scene): [number, string][] =>
        scene.state?.inputHash === undefined ? [] : [[scene.order, scene.state.inputHash]],
      ),
    ),
    entries: recorded.flatMap((scene) =>
      (scene.state?.statements ?? []).map((statement) => toEntry(statement, scene, lookup)),
    ),
  };
}

export function splitStoryState(
  state: StoryState,
  orders: readonly number[],
  lookup: StoryLedgerLookup,
): ReadonlyMap<number, SceneStoryState> {
  return new Map(
    orders.flatMap((order): [number, SceneStoryState][] => {
      const entries: readonly StoryStateEntry[] = state.entries.filter(
        (entry) => entry.throughScene === order,
      );
      const inputHash: string | undefined = state.sceneInputHashes.get(order);
      if (entries.length === 0 && inputHash === undefined) {
        return [];
      }

      const isStale: boolean = entries.some((entry) => entry.isStale === true);
      return [
        [
          order,
          {
            ...(inputHash === undefined ? {} : { inputHash }),
            ...(isStale ? { stale: true } : {}),
            statements: entries.map((entry) => toStatement(entry, lookup)),
          },
        ],
      ];
    }),
  );
}
