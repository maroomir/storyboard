export const cardEditorViewType: string = 'storyboard.card';

interface SidebarViewIds {
  readonly characters: string;
  readonly backgrounds: string;
  readonly scenes: string;
  readonly studio: string;
}

export const sidebarViewIds: SidebarViewIds = {
  characters: 'storyboard.charactersView',
  backgrounds: 'storyboard.backgroundsView',
  scenes: 'storyboard.scenesView',
  studio: 'storyboard.studioView',
};

export const workspaceReadyContextKey: string = 'storyboard.workspaceReady';
