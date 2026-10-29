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

export interface StoryboardCommandIds {
  readonly init: string;
  readonly notesAbsorb: string;
  readonly characterCreate: string;
  readonly backgroundCreate: string;
  readonly characterRecommend: string;
  readonly backgroundRecommend: string;
  readonly cardsBuildFromScenes: string;
  readonly characterRename: string;
  readonly backgroundRename: string;
  readonly apiKeySet: string;
  readonly draftGenerate: string;
  readonly draftRegenerate: string;
  readonly sceneBeats: string;
  readonly draftGenerateAll: string;
  readonly novelGenerate: string;
  readonly outlineGenerate: string;
  readonly sceneGenerateAllSeeds: string;
  readonly sceneCompleteStory: string;
  readonly manuscriptAssemble: string;
  readonly manuscriptReview: string;
  readonly manuscriptSummaries: string;
  readonly draftApplyFormat: string;
  readonly stateReseal: string;
  readonly sceneCreate: string;
  readonly sceneRename: string;
  readonly sceneOpenDraft: string;
  readonly relationGraphOpen: string;
  readonly settingsOpen: string;
  readonly draftGrammarCheck: string;
  readonly draftContinuityCheck: string;
  readonly draftSlopCheck: string;
  readonly draftReviseLoop: string;
  readonly draftCondense: string;
  readonly biblePromoteCandidates: string;
  readonly cardsPromoteCandidates: string;
  readonly bibleCanonDiff: string;
  readonly draftExpand: string;
  readonly draftAugment: string;
  readonly draftAugmentSelection: string;
  readonly draftEditSelection: string;
  readonly draftExport: string;
  readonly providerChoose: string;
  readonly draftApplyGrammarFix: string;
}

export const storyboardCommandIds: StoryboardCommandIds = {
  init: 'storyboard.init',
  notesAbsorb: 'storyboard.notes.absorb',
  characterCreate: 'storyboard.character.create',
  backgroundCreate: 'storyboard.background.create',
  characterRecommend: 'storyboard.character.recommend',
  backgroundRecommend: 'storyboard.background.recommend',
  cardsBuildFromScenes: 'storyboard.cards.buildFromScenes',
  characterRename: 'storyboard.character.rename',
  backgroundRename: 'storyboard.background.rename',
  apiKeySet: 'storyboard.apiKey.set',
  draftGenerate: 'storyboard.draft.generate',
  draftRegenerate: 'storyboard.draft.regenerate',
  sceneBeats: 'storyboard.scene.beats',
  draftGenerateAll: 'storyboard.draft.generateAll',
  novelGenerate: 'storyboard.novel.generate',
  outlineGenerate: 'storyboard.outline.generate',
  sceneGenerateAllSeeds: 'storyboard.scene.generateAllSeeds',
  sceneCompleteStory: 'storyboard.scene.completeStory',
  manuscriptAssemble: 'storyboard.manuscript.assemble',
  manuscriptReview: 'storyboard.manuscript.review',
  manuscriptSummaries: 'storyboard.manuscript.summaries',
  draftApplyFormat: 'storyboard.draft.applyFormat',
  stateReseal: 'storyboard.state.reseal',
  sceneCreate: 'storyboard.scene.create',
  sceneRename: 'storyboard.scene.rename',
  sceneOpenDraft: 'storyboard.scene.openDraft',
  relationGraphOpen: 'storyboard.relationGraph.open',
  settingsOpen: 'storyboard.settings.open',
  draftGrammarCheck: 'storyboard.draft.grammarCheck',
  draftContinuityCheck: 'storyboard.draft.continuityCheck',
  draftSlopCheck: 'storyboard.draft.slopCheck',
  draftReviseLoop: 'storyboard.draft.reviseLoop',
  draftCondense: 'storyboard.draft.condense',
  biblePromoteCandidates: 'storyboard.bible.promoteCandidates',
  cardsPromoteCandidates: 'storyboard.cards.promoteCandidates',
  bibleCanonDiff: 'storyboard.bible.canonDiff',
  draftExpand: 'storyboard.draft.expand',
  draftAugment: 'storyboard.draft.augment',
  draftAugmentSelection: 'storyboard.draft.augmentSelection',
  draftEditSelection: 'storyboard.draft.editSelection',
  draftExport: 'storyboard.draft.export',
  providerChoose: 'storyboard.provider.choose',
  draftApplyGrammarFix: 'storyboard.draft.applyGrammarFix',
};
