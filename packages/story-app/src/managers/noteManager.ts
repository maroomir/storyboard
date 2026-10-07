import type {
  ApplyNoteAbsorbRequest,
  ApplyNoteAbsorbResult,
  ApplyNoteAbsorbUseCase,
  CollectNotesRequest,
  CollectNotesResult,
  CollectNotesUseCase,
  DiscardNoteCandidatesRequest,
  DiscardNoteCandidatesResult,
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
  readonly secretStore: SecretStore;
}

// Bringing an author's notes (an Obsidian vault, a Notion page) into the workspace: read them,
// let the model sort them into cards, scenes and the contract, then write what is new. The steps
// are separate verbs so a host can show the estimate and the plan before anything is spent or
// written.
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

  public discardCandidates(
    workspaceRoot: StoryUri,
    request: DiscardNoteCandidatesRequest,
  ): Promise<DiscardNoteCandidatesResult> {
    return this.deps.promoteNoteCandidatesUseCase.discard(workspaceRoot, request);
  }
}
