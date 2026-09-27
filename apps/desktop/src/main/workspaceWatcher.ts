import { watch, type FSWatcher } from 'node:fs';
import { sep } from 'node:path';

import { workspaceConfigRelativePath } from '@storyboard/story-config';
import { STORYBOARD_RELATIVE_PATHS } from '@storyboard/story-format';

import type { WorkspaceArea } from '@/shared/ipcContract';

export interface WorkspaceChange {
  readonly areas: readonly WorkspaceArea[];
  readonly draftStems: readonly string[];
}

const settleDelayMs = 250;
const paths = STORYBOARD_RELATIVE_PATHS;

function isInside(path: string, directory: string): boolean {
  return path.startsWith(`${directory}/`);
}

// Which screens a changed file affects. Anything else under the workspace (the git directory,
// caches, the assembled manuscript) changes nothing the author is looking at.
export function classifyWorkspacePath(relativePath: string): {
  readonly area?: WorkspaceArea;
  readonly draftStem?: string;
} {
  const path = relativePath.split(sep).join('/');

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

// Watches the whole workspace recursively (native on macOS and Windows) and reports what changed
// in one settled batch, so a pipeline writing ten files produces one refresh, not ten.
export function watchWorkspace(
  workspaceRoot: string,
  onChange: (change: WorkspaceChange) => void,
): { readonly dispose: () => void } {
  const areas = new Set<WorkspaceArea>();
  const draftStems = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  let watcher: FSWatcher | undefined;

  const flush = (): void => {
    timer = undefined;
    const change = { areas: [...areas], draftStems: [...draftStems] };
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
    // NOTE: 감시를 못 걸면 외부 변경이 자동으로 보이지 않을 뿐이다. 화면을 다시 열면 읽힌다.
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
