import type { BibleFact, StoryBible } from './bible';
import type { CharacterCard } from './card';
import { z } from 'zod';

import { parseSceneStem, type SceneFileNameParts } from './scene';
import type { StoryState, StoryStateEntry } from './storyState';

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

export function rewriteBibleSceneReferences(bible: StoryBible, rename: SceneRename): StoryBible {
  let changed: boolean = false;

  const facts: BibleFact[] = bible.facts.map((fact) => {
    const rewritten: BibleFact = rewriteFactSceneReferences(fact, rename);
    changed ||= rewritten !== fact;
    return rewritten;
  });

  return changed ? { ...bible, facts } : bible;
}

function rewriteFactSceneReferences(fact: BibleFact, rename: SceneRename): BibleFact {
  const next: BibleFact = { ...fact };
  let changed: boolean = false;

  const rewrite = <T extends string | number | undefined>(ref: T): T => {
    const rewritten: T = rewriteSceneReference(ref, rename) as T;
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

const bareOrderTextPattern: RegExp = /^\d+$/;

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

export function rewriteSceneCardStemText(rawCard: string, rename: SceneRename): string {
  const { from, to } = rename;
  const escapedStem: string = from.stem.replace(/-/g, '\\-');
  const fieldLine = (field: string, suffix: string): RegExp =>
    new RegExp(
      `^(${field}:[ \\t]*['"]?)${escapedStem}${suffix.replace(/\./g, '\\.')}(['"]?[ \\t]*)$`,
      'm',
    );

  return rawCard
    .replace(fieldLine('id', ''), `$1${to.stem}$2`)
    .replace(fieldLine('summary', '.summary.md'), `$1${to.stem}.summary.md$2`);
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
