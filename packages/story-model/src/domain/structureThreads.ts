import { resolveCompositionPresetDefaults } from '#model/format/compositionPresets';
import { mainThreadId, type StoryThread } from '#model/format/project';
import type { StoryStructure, StructureThread } from '#model/format/structure';

function defaultMainThread(): StructureThread {
  return { id: mainThreadId, title: resolveCompositionPresetDefaults().mainThreadTitle };
}

function isDefaultMainOnly(threads: readonly StructureThread[]): boolean {
  const [onlyThread] = threads;
  const main: StructureThread = defaultMainThread();

  return (
    threads.length === 1 &&
    onlyThread?.id === main.id &&
    onlyThread.title === main.title &&
    (onlyThread.wraps ?? []).length === 0
  );
}

export function projectThreadsOfStructure(
  structure: StoryStructure | undefined,
): Record<string, StoryThread> | undefined {
  if (structure === undefined || isDefaultMainOnly(structure.threads)) {
    return undefined;
  }

  return Object.fromEntries(
    structure.threads.map((thread) => [
      thread.id,
      {
        title: thread.title,
        ...(thread.wraps === undefined || thread.wraps.length === 0
          ? {}
          : { wraps: [...thread.wraps] }),
      },
    ]),
  );
}

export function structureWithProjectThreads(
  structure: StoryStructure | undefined,
  threads: Readonly<Record<string, StoryThread>> | undefined,
): StoryStructure {
  const structureThreads: StructureThread[] =
    threads === undefined || Object.keys(threads).length === 0
      ? [defaultMainThread()]
      : Object.entries(threads).map(([id, thread]) => ({
          id,
          title: thread.title,
          ...(thread.wraps === undefined || thread.wraps.length === 0
            ? {}
            : { wraps: [...thread.wraps] }),
        }));

  return { threads: structureThreads, scenes: [...(structure?.scenes ?? [])] };
}
