import type {
  OutlineSynopsis,
  SceneCard,
  StoryUri,
  StoryboardCard,
  StoryboardProject,
  NoteAbsorbPlan,
  NoteBundle,
  Statement,
  PendingHeaderChange,
  NoteExtractionResponse,
  BibleSubjectKind,
  NoteSourceKind,
  NoteVoiceSeed,
} from '@storyboard/story-model';

export interface NoteSynopsisCandidate {
  readonly location: string;
  readonly absorbedAt: string;
  readonly markdown: string;
}

export interface INoteAbsorbRepository {
  saveBundle(workspaceRoot: StoryUri, bundle: NoteBundle): Promise<void>;
  savePlan(workspaceRoot: StoryUri, location: string, plan: NoteAbsorbPlan): Promise<void>;
  saveExtractionResponses(
    workspaceRoot: StoryUri,
    location: string,
    responses: readonly NoteExtractionResponse[],
  ): Promise<void>;
  saveCardPending(
    workspaceRoot: StoryUri,
    location: string,
    cardId: string,
    statements: readonly Statement[],
    header?: PendingHeaderChange,
  ): Promise<void>;
  clearCardPending(workspaceRoot: StoryUri, location?: string): Promise<void>;
  listCardsWithPending(workspaceRoot: StoryUri): Promise<readonly string[]>;
  loadCard(
    workspaceRoot: StoryUri,
    cardType: BibleSubjectKind,
    id: string,
  ): Promise<StoryboardCard | undefined>;
  sceneExists(workspaceRoot: StoryUri, fileName: string): Promise<boolean>;
  writeScene(workspaceRoot: StoryUri, fileName: string, card: SceneCard): Promise<void>;
  synopsisExists(workspaceRoot: StoryUri): Promise<boolean>;
  writeSynopsis(workspaceRoot: StoryUri, synopsis: OutlineSynopsis): Promise<void>;
  listSynopsisCandidates(workspaceRoot: StoryUri): Promise<readonly NoteSynopsisCandidate[]>;
  saveSynopsisCandidate(
    workspaceRoot: StoryUri,
    location: string,
    synopsis: OutlineSynopsis | undefined,
  ): Promise<void>;
  clearSynopsisCandidates(workspaceRoot: StoryUri, location?: string): Promise<void>;
  addVoiceSeeds(
    workspaceRoot: StoryUri,
    sourceKind: NoteSourceKind,
    seeds: Readonly<Record<string, readonly NoteVoiceSeed[]>>,
  ): Promise<void>;
  loadProject(workspaceRoot: StoryUri): Promise<StoryboardProject>;
  saveProject(workspaceRoot: StoryUri, project: StoryboardProject): Promise<void>;
}
