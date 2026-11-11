export type ElementKind = 'character' | 'background' | 'scene' | 'narrator';

export const elementKinds: readonly ElementKind[] = ['character', 'background', 'scene', 'narrator'];

export const elementKindLabels: Record<ElementKind, string> = {
  character: '인물',
  background: '배경',
  scene: '씬',
  narrator: '서술자',
};

export function isElementKind(value: string): value is ElementKind {
  return (elementKinds as readonly string[]).includes(value);
}
