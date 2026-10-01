import type { BibleFact, StoryBible } from './bible';
import type { CharacterCard } from './card';
import type { SceneFileNameParts } from './scene';
import type { StoryState, StoryStateEntry } from './storyState';

// A scene rename moves the stem and possibly the order. Every reference written as the old stem
// follows the stem; every reference written as a bare order follows the order.
export interface SceneRename {
  readonly from: SceneFileNameParts;
  readonly to: SceneFileNameParts;
}

export function renumberStoryStateScene(state: StoryState, rename: SceneRename): StoryState {
  const { from, to } = rename;

  const isReferenced =
    state.throughSceneOrder === from.order ||
    state.sceneInputHashes.has(from.order) ||
    state.entries.some((entry) => entry.throughScene === from.order);

  if (from.order === to.order || !isReferenced) {
    return state;
  }

  const renumber = (order: number): number => (order === from.order ? to.order : order);
  const sceneInputHashes = new Map<number, string>();

  for (const [order, hash] of state.sceneInputHashes) {
    sceneInputHashes.set(renumber(order), hash);
  }

  const entries = state.entries.map(
    (entry): StoryStateEntry =>
      entry.throughScene === from.order ? { ...entry, throughScene: to.order } : entry,
  );

  // NOTE: through-scene is a high-water mark. Moving the scene that set it lowers it to whatever
  // is still sealed; moving a scene past it raises it.
  const sealedOrders = [
    ...sceneInputHashes.keys(),
    ...entries.flatMap((entry) => (entry.throughScene === undefined ? [] : [entry.throughScene])),
  ];
  const throughSceneOrder = Math.max(
    state.throughSceneOrder === from.order ? 0 : state.throughSceneOrder,
    ...sealedOrders,
  );

  return { throughSceneOrder, sceneInputHashes, entries };
}

export function rewriteBibleSceneReferences(bible: StoryBible, rename: SceneRename): StoryBible {
  let changed = false;

  const facts = bible.facts.map((fact) => {
    const rewritten = rewriteFactSceneReferences(fact, rename);
    changed ||= rewritten !== fact;
    return rewritten;
  });

  return changed ? { ...bible, facts } : bible;
}

function rewriteFactSceneReferences(fact: BibleFact, rename: SceneRename): BibleFact {
  const next: BibleFact = { ...fact };
  let changed = false;

  const rewrite = <T extends string | number | undefined>(ref: T): T => {
    const rewritten = rewriteSceneReference(ref, rename) as T;
    changed ||= rewritten !== ref;
    return rewritten;
  };

  if (fact.sourceScene !== undefined) {
    next.sourceScene = rewrite(fact.sourceScene);
  }

  if (fact.validFrom !== undefined) {
    next.validFrom = rewrite(fact.validFrom);
  }

  if (fact.validUntil !== undefined) {
    next.validUntil = rewrite(fact.validUntil);
  }

  if (typeof fact.revealFrom === 'object') {
    next.revealFrom = { ...fact.revealFrom, scene: rewrite(fact.revealFrom.scene) };
  } else if (fact.revealFrom !== undefined) {
    next.revealFrom = rewrite(fact.revealFrom);
  }

  return changed ? next : fact;
}

const bareOrderTextPattern = /^\d+$/;

function rewriteSceneReference(
  ref: string | number | undefined,
  rename: SceneRename,
): string | number | undefined {
  const { from, to } = rename;

  if (ref === from.stem) {
    return to.stem;
  }

  if (typeof ref === 'number') {
    return ref === from.order ? to.order : ref;
  }

  if (
    ref !== undefined &&
    bareOrderTextPattern.test(ref) &&
    Number.parseInt(ref, 10) === from.order
  ) {
    return String(to.order).padStart(ref.length, '0');
  }

  return ref;
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

// NOTE: The scene card is edited as text, not re-serialized: a rename must not mix the card
// canonicalization that only `doctor` performs into the diff.
export function rewriteSceneCardStemText(rawCard: string, rename: SceneRename): string {
  const { from, to } = rename;
  const escapedStem = from.stem.replace(/-/g, '\\-');
  const fieldLine = (field: string, suffix: string): RegExp =>
    new RegExp(
      `^(${field}:[ \\t]*['"]?)${escapedStem}${suffix.replace(/\./g, '\\.')}(['"]?[ \\t]*)$`,
      'm',
    );

  return rawCard
    .replace(fieldLine('id', ''), `$1${to.stem}$2`)
    .replace(fieldLine('summary', '.summary.md'), `$1${to.stem}.summary.md$2`);
}
