import type { CharacterCard } from '#model/format/card';
import { z } from 'zod';

import { parseSceneStem, type SceneFileNameParts } from '#model/format/scene';

export interface SceneRename {
  readonly from: SceneFileNameParts;
  readonly to: SceneFileNameParts;
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
