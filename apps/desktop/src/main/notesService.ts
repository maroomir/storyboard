import { extractErrorMessage, isNotionUrl, NodeUri } from '@storyboard/story-model';
import type { NoteAbsorbPlan, NoteBundle } from '@storyboard/story-model';
import type { ApplyNoteAbsorbResult, CollectNotesResult, NoteLocation, PlanNoteAbsorbResult } from '@storyboard/story-engine';

import type { NotesApplyView, NotesEstimateView, NotesPlanView } from '@/shared/dto';
import type { MessageKey, MessageParams } from '@/shared/i18n/translate';

import type { DesktopContainer } from '@/main/desktopContainer';
import { fail, succeed, type ServiceResult } from '@/main/serviceResult';

export type NotesLocationRequest =
  | { readonly kind: 'path'; readonly path: string }
  | { readonly kind: 'notion'; readonly pageUrl: string };

export class NotesService {
  private bundle: NoteBundle | undefined;
  private plan: NoteAbsorbPlan | undefined;

  public constructor(
    private readonly container: Pick<DesktopContainer, 'notes' | 'workspaceRoot'>,
    private readonly translate: (key: MessageKey, params?: MessageParams) => string,
  ) {}

  public async collect(request: NotesLocationRequest): Promise<ServiceResult<NotesEstimateView>> {
    const location: NoteLocation | undefined = toNoteLocation(request);

    if (location === undefined) {
      return fail('invalid-request', this.translate('error.invalidRequest'));
    }

    const collected: CollectNotesResult = await this.container.notes.collect({ workspaceRoot: this.container.workspaceRoot, location });

    if (!collected.ok) {
      return fail('failed', collected.message);
    }

    this.bundle = collected.bundle;
    this.plan = undefined;

    let estimate: ReturnType<typeof this.container.notes.estimate>;
    try {
      estimate = this.container.notes.estimate(collected.bundle);
    } catch (error) {
      return fail('provider-missing', extractErrorMessage(error));
    }

    return succeed({
      location: collected.bundle.location,
      noteCount: estimate.noteCount,
      linkedNoteCount: estimate.linkedNoteCount,
      characterCount: estimate.characterCount,
      skippedCount: collected.bundle.skipped.length,
      requestCount: estimate.requestCount,
      providerId: estimate.providerId,
      model: estimate.model,
      ...(estimate.costCeilingUsd === undefined ? {} : { costCeilingUsd: estimate.costCeilingUsd }),
    });
  }

  public async planAbsorb(): Promise<ServiceResult<NotesPlanView>> {
    if (this.bundle === undefined) {
      return fail('invalid-request', this.translate('notes.noBundle'));
    }

    const planned: PlanNoteAbsorbResult = await this.container.notes.plan({ workspaceRoot: this.container.workspaceRoot, bundle: this.bundle });

    if (!planned.ok) {
      return fail('failed', planned.message);
    }

    this.plan = planned.plan;

    return succeed({
      newCards: planned.plan.cards.filter((card) => card.isNew).map((card) => card.card.name),
      changedCards: planned.plan.cards.filter((card) => !card.isNew).map((card) => card.card.name),
      sceneCount: planned.plan.scenes.length,
      skippedSceneCount: planned.plan.skippedScenes.length,
      hasSynopsis: planned.plan.synopsis !== undefined,
      canonCandidateCount: planned.plan.canonCandidates.length,
      unclassifiedNotes: planned.plan.unclassifiedNotes.map((note) => note.title),
      warnings: planned.plan.warnings,
    });
  }

  public async apply(shouldFillContract: boolean): Promise<ServiceResult<NotesApplyView>> {
    if (this.bundle === undefined || this.plan === undefined) {
      return fail('invalid-request', this.translate('notes.noPlan'));
    }

    const applied: ApplyNoteAbsorbResult = await this.container.notes.apply({
      workspaceRoot: this.container.workspaceRoot,
      plan: this.plan,
      location: this.bundle.location,
      shouldFillContract,
      shouldReplaceCandidates: false,
    });

    if (!applied.ok) {
      return fail('failed', applied.message);
    }

    this.plan = undefined;

    return succeed({
      createdCards: applied.createdCards,
      createdScenes: applied.createdScenes,
      pendingCandidateCards: applied.pendingCandidateCards,
      canonCandidateCount: applied.canonCandidates,
      synopsis: applied.synopsis,
      filledSettingKeys: applied.filledSettingKeys,
      settingProposals: Object.fromEntries(
        Object.entries(applied.settingProposals).map(([key, value]) => [key, String(value)]),
      ),
    });
  }
}

function toNoteLocation(request: NotesLocationRequest): NoteLocation | undefined {
  if (request.kind === 'notion') {
    return isNotionUrl(request.pageUrl) ? { kind: 'notion', pageUrl: request.pageUrl } : undefined;
  }

  return /\.zip$/i.test(request.path)
    ? { kind: 'notion-export', archive: NodeUri.file(request.path) }
    : { kind: 'obsidian', root: NodeUri.file(request.path) };
}
