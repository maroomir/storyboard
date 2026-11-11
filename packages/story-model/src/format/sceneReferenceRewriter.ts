import type { CharacterCard } from '#model/format/card';
import { z } from 'zod';

import { parseSceneStem, type SceneFileNameParts } from '#model/format/scene';
import type { StoryState, StoryStateEntry } from '#model/format/storyState';

export interface SceneRename {
  readonly from: SceneFileNameParts;
  readonly to: SceneFileNameParts;
}

export function renumberStoryStateScene(state: StoryState, rename: SceneRename): StoryState {
  const { from, to } = rename;

  const isReferenced: boolean =
    state.throughSceneOrder === from.order ||
    state.sceneInputHashes.has(from.order) ||
    state.entries.some((entry) => entry.throughScene === from.order);

  if (from.order === to.order || !isReferenced) {
    return state;
  }

  const renumber = (order: number): number => (order === from.order ? to.order : order);
  const sceneInputHashes: Map<number, string> = new Map<number, string>();

  for (const [order, hash] of state.sceneInputHashes) {
    sceneInputHashes.set(renumber(order), hash);
  }

  const entries: StoryStateEntry[] = state.entries.map(
    (entry): StoryStateEntry =>
      entry.throughScene === from.order ? { ...entry, throughScene: to.order } : entry,
  );

  const sealedOrders: number[] = [
    ...sceneInputHashes.keys(),
    ...entries.flatMap((entry) => (entry.throughScene === undefined ? [] : [entry.throughScene])),
  ];
  const throughSceneOrder: number = Math.max(
    state.throughSceneOrder === from.order ? 0 : state.throughSceneOrder,
    ...sealedOrders,
  );

  return { throughSceneOrder, sceneInputHashes, entries };
}

export function rewriteCharacterArcSceneRefs(
  card: CharacterCard,
  rename: SceneRename,
): CharacterCard {
  if (card.arc === undefined || !card.arc.some((stage) => stage.sceneRef === rename.from.stem)) {
    return card;
  }

  return {
    ...card,
    arc: card.arc.map((stage) =>
      stage.sceneRef === rename.from.stem ? { ...stage, sceneRef: rename.to.stem } : stage,
    ),
  };
}

interface SceneRenameJournal {
  fromStem: string;
  toStem: string;
}

const sceneRenameJournalSchema: z.ZodType<SceneRenameJournal> = z.object({
  fromStem: z.string(),
  toStem: z.string(),
});

export function serializeSceneRenameJournal(rename: SceneRename): string {
  return `${JSON.stringify({ fromStem: rename.from.stem, toStem: rename.to.stem }, null, 2)}\n`;
}

export function parseSceneRenameJournal(raw: string): SceneRename | undefined {
  let value: unknown;

  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }

  const parsed: z.ZodSafeParseResult<SceneRenameJournal> =
    sceneRenameJournalSchema.safeParse(value);
  const from: SceneFileNameParts | undefined = parsed.success
    ? parseSceneStem(parsed.data.fromStem)
    : undefined;
  const to: SceneFileNameParts | undefined = parsed.success
    ? parseSceneStem(parsed.data.toStem)
    : undefined;

  return from === undefined || to === undefined ? undefined : { from, to };
}
