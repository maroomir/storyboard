import { watch, type FSWatcher } from 'node:fs';
import { sep } from 'node:path';

import { workspaceConfigRelativePath } from '@storyboard/story-config';
import { STORYBOARD_RELATIVE_PATHS, type StoryboardRelativePaths } from '@storyboard/story-model';

import type { DesktopEvents, WorkspaceArea } from '@/shared/ipcContract';

export interface WorkspaceChange {
  readonly areas: readonly WorkspaceArea[];
  readonly draftStems: readonly string[];
}

const settleDelayMs: number = 250;
const paths: StoryboardRelativePaths = STORYBOARD_RELATIVE_PATHS;

function isInside(path: string, directory: string): boolean {
  return path.startsWith(`${directory}/`);
}

export function classifyWorkspacePath(relativePath: string): {
  readonly area?: WorkspaceArea;
  readonly draftStem?: string;
} {
  const path: string = relativePath.split(sep).join('/');

  if (isInside(path, paths.draftDirectory) && path.endsWith('.md')) {
    return { area: 'draft', draftStem: path.slice(paths.draftDirectory.length + 1, -'.md'.length) };
  }

  if (isInside(path, paths.sceneDirectory) || isInside(path, paths.outlineDirectory)) {
    return { area: 'toc' };
  }

  if (
    isInside(path, paths.characterDirectory) ||
    isInside(path, paths.backgroundDirectory) ||
    isInside(path, paths.narratorDirectory)
  ) {
    return { area: 'bible' };
  }

  if (isInside(path, paths.bibleDirectory)) {
    return { area: 'canon' };
  }

  if (path === paths.runLock) {
    return { area: 'lock' };
  }

  if (path === paths.projectJson || path === workspaceConfigRelativePath) {
    return { area: 'settings' };
  }

  return {};
}

function showOutsideChangesOnlyOnReopen(): void {}

export function watchWorkspace(
  workspaceRoot: string,
  onChange: (change: WorkspaceChange) => void,
): { readonly dispose: () => void } {
  const areas: Set<WorkspaceArea> = new Set<WorkspaceArea>();
  const draftStems: Set<string> = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  let watcher: FSWatcher | undefined;

  const flush = (): void => {
    timer = undefined;
    const change: DesktopEvents['workspace.changed'] = { areas: [...areas], draftStems: [...draftStems] };
    areas.clear();
    draftStems.clear();
    onChange(change);
  };

  try {
    watcher = watch(workspaceRoot, { recursive: true }, (_event, fileName) => {
      if (fileName === null) {
        return;
      }

      const { area, draftStem } = classifyWorkspacePath(String(fileName));

      if (area === undefined) {
        return;
      }

      areas.add(area);
      if (draftStem !== undefined) {
        draftStems.add(draftStem);
      }

      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(flush, settleDelayMs);
    });
    watcher.on('error', () => undefined);
  } catch {
    showOutsideChangesOnlyOnReopen();
  }

  return {
    dispose: (): void => {
      if (timer) {
        clearTimeout(timer);
      }
      watcher?.close();
    },
  };
}
