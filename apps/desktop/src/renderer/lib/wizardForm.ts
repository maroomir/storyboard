import type { WorkspaceCreateRequest } from '@/shared/ipcContract';

export type WizardStep = 'story' | 'telling' | 'concept';

export const wizardSteps: readonly WizardStep[] = ['story', 'telling', 'concept'];

export const initialWizardForm: WorkspaceCreateRequest = {
  title: '',
  genre: '',
  audience: '',
  pov: 'third-limited',
  composition: 'linear',
  chapterCount: 12,
  scenesPerChapter: 4,
  targetWordCount: 150_000,
  concept: '',
};

export function isStepComplete(step: WizardStep, form: WorkspaceCreateRequest): boolean {
  switch (step) {
    case 'story':
      return [form.title, form.genre, form.audience].every((value) => value.trim().length > 0);
    case 'telling':
      return form.chapterCount >= 1 && form.scenesPerChapter >= 1 && form.targetWordCount >= 1_000;
    case 'concept':
      return form.concept.trim().length > 0;
  }
}

export function lengthHint(form: WorkspaceCreateRequest): { readonly scenes: number; readonly perScene: number } {
  const scenes = Math.max(1, form.chapterCount * form.scenesPerChapter);
  return { scenes, perScene: Math.round(form.targetWordCount / scenes) };
}
