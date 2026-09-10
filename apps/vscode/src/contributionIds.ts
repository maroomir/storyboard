// package.json 의 contributes 와 짝을 이루는 식별자. 매니페스트는 import 할 수 없으므로 값은 두 벌
// 존재할 수밖에 없고, 대신 test/unit/presentation/manifest.spec.ts 가 둘이 같은지 확인한다.
// 여기 없는 문자열을 화면 코드에 직접 적으면 그 대조에서 빠진다.

export const cardEditorViewType = 'storyboard.card';

export const sidebarViewIds = {
  characters: 'storyboard.charactersView',
  backgrounds: 'storyboard.backgroundsView',
  scenes: 'storyboard.scenesView',
  studio: 'storyboard.studioView',
} as const;

// 워크스페이스가 열렸는지 알리는 컨텍스트 키. 매니페스트의 when 절이 같은 이름을 본다.
export const workspaceReadyContextKey = 'storyboard.workspaceReady';
