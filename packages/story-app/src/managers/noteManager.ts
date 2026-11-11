import type {
  ApplyNoteAbsorbRequest,
  ApplyNoteAbsorbResult,
  ApplyNoteAbsorbUseCase,
  CollectNotesRequest,
  CollectNotesResult,
  CollectNotesUseCase,
  ExportNotesRequest,
  ExportNotesResult,
  ExportNotesUseCase,
  NoteAbsorbEstimate,
  PlanNoteAbsorbRequest,
  PlanNoteAbsorbResult,
  PlanNoteAbsorbUseCase,
  ApplySynopsisCandidateResult,
  NoteSynopsisCandidate,
  SynopsisCandidateDesk,
} from '@storyboard/story-engine';
import type { NoteBundle, StoryUri } from '@storyboard/story-model';
import type { SecretStore } from '@storyboard/story-ai';

export interface NoteManagerDependencies {
  readonly collectNotesUseCase: CollectNotesUseCase;
  readonly planNoteAbsorbUseCase: PlanNoteAbsorbUseCase;
  readonly applyNoteAbsorbUseCase: ApplyNoteAbsorbUseCase;
  readonly synopsisCandidateDesk: SynopsisCandidateDesk;
  readonly exportNotesUseCase: ExportNotesUseCase;
  readonly secretStore: SecretStore;
}

export class NoteManager {
  public constructor(private readonly deps: NoteManagerDependencies) {}

  public connectNotion(token: string): Promise<void> {
    return this.deps.secretStore.setNotionToken(token);
  }

  public collect(request: CollectNotesRequest): Promise<CollectNotesResult> {
    return this.deps.collectNotesUseCase.execute(request);
  }

  public estimate(bundle: NoteBundle): NoteAbsorbEstimate {
    return this.deps.planNoteAbsorbUseCase.estimate(bundle);
  }

  public plan(request: PlanNoteAbsorbRequest): Promise<PlanNoteAbsorbResult> {
    return this.deps.planNoteAbsorbUseCase.execute(request);
  }

  public apply(request: ApplyNoteAbsorbRequest): Promise<ApplyNoteAbsorbResult> {
    return this.deps.applyNoteAbsorbUseCase.execute(request);
  }

  public export(request: ExportNotesRequest): Promise<ExportNotesResult> {
    return this.deps.exportNotesUseCase.execute(request);
  }

  public listSynopsisCandidates(workspaceRoot: StoryUri): Promise<readonly NoteSynopsisCandidate[]> {
    return this.deps.synopsisCandidateDesk.list(workspaceRoot);
  }

  public applySynopsisCandidate(
    workspaceRoot: StoryUri,
    location?: string,
  ): Promise<ApplySynopsisCandidateResult> {
    return this.deps.synopsisCandidateDesk.apply(workspaceRoot, location);
  }

  public discardSynopsisCandidates(workspaceRoot: StoryUri, location?: string): Promise<number> {
    return this.deps.synopsisCandidateDesk.discard(workspaceRoot, location);
  }
}
