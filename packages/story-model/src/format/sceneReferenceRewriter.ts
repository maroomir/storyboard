import type { CharacterCard } from '#model/format/card';

import type { SceneFileNameParts } from '#model/format/scene';

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
