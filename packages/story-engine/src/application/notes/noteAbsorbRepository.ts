import type {
  OutlineSynopsis,
  SceneCard,
  StoryUri,
  StoryboardCard,
  StoryboardProject,
  NoteAbsorbPlan,
  NoteBundle,
  NoteCandidateFile,
  NoteExtractionResponse,
} from '@storyboard/story-model';

// A file written before 0.13 kept one absorb only; it is no longer read, and the next write
// replaces it.
export type NoteCandidateLoad =
  | { readonly kind: 'current'; readonly file: NoteCandidateFile }
  | { readonly kind: 'legacy' }
  | { readonly kind: 'none' };

export type NoteCandidateFileErrorCode = 'unreadable';

export class NoteCandidateFileError extends Error {
  public constructor(
    public readonly code: NoteCandidateFileErrorCode,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'NoteCandidateFileError';
  }
}

// What the note import reads and writes. The bundle, the plan and the candidates live in the
// workspace's cache, which git ignores: the notes stay the author's, and only what they turn into
// is written to the workspace proper.
export interface INoteAbsorbRepository {
  saveBundle(workspaceRoot: StoryUri, bundle: NoteBundle): Promise<void>;
  savePlan(workspaceRoot: StoryUri, plan: NoteAbsorbPlan): Promise<void>;
  saveExtractionResponses(
    workspaceRoot: StoryUri,
    responses: readonly NoteExtractionResponse[],
  ): Promise<void>;
  // Throws NoteCandidateFileError for a file that is not JSON or not a candidate file.
  loadCandidates(workspaceRoot: StoryUri): Promise<NoteCandidateLoad>;
  // A file with no sources is removed, so a promoted or discarded candidate does not linger.
  saveCandidates(workspaceRoot: StoryUri, file: NoteCandidateFile): Promise<void>;
  loadCard(
    workspaceRoot: StoryUri,
    cardType: 'character' | 'background',
    id: string,
  ): Promise<StoryboardCard | undefined>;
  sceneExists(workspaceRoot: StoryUri, fileName: string): Promise<boolean>;
  writeScene(workspaceRoot: StoryUri, fileName: string, card: SceneCard): Promise<void>;
  synopsisExists(workspaceRoot: StoryUri): Promise<boolean>;
  writeSynopsis(workspaceRoot: StoryUri, synopsis: OutlineSynopsis): Promise<void>;
  // The notes' synopses kept beside an author's own. Empty text removes the file.
  loadSynopsisCandidate(workspaceRoot: StoryUri): Promise<string | undefined>;
  saveSynopsisCandidate(workspaceRoot: StoryUri, text: string): Promise<void>;
  loadProject(workspaceRoot: StoryUri): Promise<StoryboardProject>;
  saveProject(workspaceRoot: StoryUri, project: StoryboardProject): Promise<void>;
}
