import type {
  ApplyNoteAbsorbRequest,
  ApplyNoteAbsorbResult,
  ApplyNoteAbsorbUseCase,
  CollectNotesRequest,
  CollectNotesResult,
  CollectNotesUseCase,
  DiscardNoteCandidatesRequest,
  DiscardNoteCandidatesResult,
  ExportNotesRequest,
  ExportNotesResult,
  ExportNotesUseCase,
  NoteAbsorbEstimate,
  PlanNoteAbsorbRequest,
  PlanNoteAbsorbResult,
  PlanNoteAbsorbUseCase,
  PrepareNoteCandidatePromotionResult,
  PromoteNoteCandidatesResult,
  PromoteNoteCandidatesUseCase,
} from '@storyboard/story-engine';
import type { MergedNoteCardCandidate, NoteBundle, StoryUri } from '@storyboard/story-model';
import type { SecretStore } from '@storyboard/story-ai';

export interface NoteManagerDependencies {
  readonly collectNotesUseCase: CollectNotesUseCase;
  readonly planNoteAbsorbUseCase: PlanNoteAbsorbUseCase;
  readonly applyNoteAbsorbUseCase: ApplyNoteAbsorbUseCase;
  readonly promoteNoteCandidatesUseCase: PromoteNoteCandidatesUseCase;
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

  public prepareCandidatePromotion(
    workspaceRoot: StoryUri,
  ): Promise<PrepareNoteCandidatePromotionResult> {
    return this.deps.promoteNoteCandidatesUseCase.prepare(workspaceRoot);
  }

  public promoteCandidates(
    workspaceRoot: StoryUri,
    candidates: readonly MergedNoteCardCandidate[],
  ): Promise<PromoteNoteCandidatesResult> {
    return this.deps.promoteNoteCandidatesUseCase.promote(workspaceRoot, candidates);
  }

  public export(request: ExportNotesRequest): Promise<ExportNotesResult> {
    return this.deps.exportNotesUseCase.execute(request);
  }

  public discardCandidates(
    workspaceRoot: StoryUri,
    request: DiscardNoteCandidatesRequest,
  ): Promise<DiscardNoteCandidatesResult> {
    return this.deps.promoteNoteCandidatesUseCase.discard(workspaceRoot, request);
  }
}
