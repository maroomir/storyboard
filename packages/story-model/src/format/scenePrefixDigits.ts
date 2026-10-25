export interface ScenePrefixDigitsInspectLike {
  readonly globalValue?: number;
  readonly workspaceValue?: number;
  readonly workspaceFolderValue?: number;
  readonly defaultValue?: number;
}

export function clampScenePrefixDigits(value: number): number {
  const n: number = Math.floor(Number.isFinite(value) ? value : 2);
  return Math.min(4, Math.max(1, n));
}

export function resolveScenePrefixDigitCount(
  projectScenePrefixDigits: number,
  inspected: ScenePrefixDigitsInspectLike | undefined | null,
): number {
  const project: number = clampScenePrefixDigits(projectScenePrefixDigits);

  if (!inspected) {
    return project;
  }

  const explicit: boolean =
    inspected.workspaceFolderValue !== undefined ||
    inspected.workspaceValue !== undefined ||
    inspected.globalValue !== undefined;

  if (!explicit) {
    return project;
  }

  const chosen: number =
    inspected.workspaceFolderValue ?? inspected.workspaceValue ?? inspected.globalValue ?? project;

  return clampScenePrefixDigits(typeof chosen === 'number' ? chosen : project);
}
