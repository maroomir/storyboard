import type {
  OutlineSynopsis,
  SceneCard,
  StoryUri,
  StoryboardCard,
  StoryboardProject,
  NoteAbsorbPlan,
  NoteBundle,
  NoteCandidateFile,
} from '@storyboard/story-model';


// What the note import reads and writes. The bundle, the plan and the candidates live in the
// workspace's cache, which git ignores: the notes stay the author's, and only what they turn into
// is written to the workspace proper.
export interface INoteAbsorbRepository {
  saveBundle(workspaceRoot: StoryUri, bundle: NoteBundle): Promise<void>;
  savePlan(workspaceRoot: StoryUri, plan: NoteAbsorbPlan): Promise<void>;
  loadCandidates(workspaceRoot: StoryUri): Promise<NoteCandidateFile | undefined>;
  // An empty list removes the file, so a promoted or superseded candidate does not linger.
  saveCandidates(workspaceRoot: StoryUri, file: NoteCandidateFile): Promise<void>;
  loadCard(
    workspaceRoot: StoryUri,
    cardType: 'character' | 'background',
    id: string,
  ): Promise<StoryboardCard | undefined>;
  sceneExists(workspaceRoot: StoryUri, fileName: string): Promise<boolean>;
  writeScene(workspaceRoot: StoryUri, fileName: string, card: SceneCard): Promise<void>;
  synopsisExists(workspaceRoot: StoryUri): Promise<boolean>;
  // `asCandidate` keeps an author's synopsis untouched and puts the notes' version beside it.
  writeSynopsis(
    workspaceRoot: StoryUri,
    synopsis: OutlineSynopsis,
    asCandidate: boolean,
  ): Promise<void>;
  loadProject(workspaceRoot: StoryUri): Promise<StoryboardProject>;
  saveProject(workspaceRoot: StoryUri, project: StoryboardProject): Promise<void>;
}
