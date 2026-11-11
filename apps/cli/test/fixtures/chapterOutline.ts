import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  outlineOfChapterPlan,
  parseChapterPlan,
  serializeChapterOutline,
  STORYBOARD_RELATIVE_PATHS,
} from '@storyboard/story-model';

function writeWorkspaceFile(workspace: string, relativePath: string, text: string): void {
  const target: string = join(workspace, ...relativePath.split('/'));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}

export function writeUnseededChapterPlan(workspace: string, chapterPlanYaml: string): void {
  writeWorkspaceFile(
    workspace,
    STORYBOARD_RELATIVE_PATHS.outlineChapters,
    serializeChapterOutline(outlineOfChapterPlan(parseChapterPlan(chapterPlanYaml), () => undefined)),
  );
  writeWorkspaceFile(workspace, STORYBOARD_RELATIVE_PATHS.pendingChapterPlan, chapterPlanYaml);
}
