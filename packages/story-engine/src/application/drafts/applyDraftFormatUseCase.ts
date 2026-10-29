import { ProjectRepository } from '#engine/persistence/repositories/projectRepository';
import type { AiServices, HostAdapters } from '#engine/application/engineServices';
import type {
  Draft,
  StoryboardProject,
  StoryboardProjectPaths,
  StoryUri,
} from '@storyboard/story-model';
import { failedResult, type IUseCase } from '#engine/application/useCase';
import {
  draftPath,
  getStoryboardProjectPaths,
  createDraft,
  parseDraft,
  readDraftFile,
  writeDraftFile,
} from '@storyboard/story-model';
import type { TaskAiConfigResolved } from '@storyboard/story-ai';

export type ApplyDraftFormatRequest = {
  readonly workspaceRoot: StoryUri;
  readonly sceneStem: string;
  readonly onSaving?: () => void;
  readonly shouldCancel?: () => boolean;
};

export type ApplyDraftFormatResult =
  | { readonly kind: 'formatted'; readonly ok: true; readonly draftUri: StoryUri }
  | { readonly kind: 'cancelled'; readonly ok: false }
  | { readonly kind: 'project_unreadable'; readonly ok: false }
  | { readonly kind: 'draft_missing'; readonly ok: false }
  | { readonly kind: 'draft_invalid'; readonly ok: false }
  | { readonly kind: 'failed'; readonly message: string; readonly ok: false };

type DraftFormatSourcesResult =
  | { readonly ok: false; readonly result: ApplyDraftFormatResult }
  | { readonly ok: true; readonly project: StoryboardProject; readonly existing: Draft };

export class ApplyDraftFormatUseCase implements IUseCase<
  ApplyDraftFormatRequest,
  ApplyDraftFormatResult
> {
  public constructor(
    private readonly host: HostAdapters,
    private readonly ai: AiServices,
  ) {}

  public async execute(request: ApplyDraftFormatRequest): Promise<ApplyDraftFormatResult> {
    const paths: StoryboardProjectPaths = getStoryboardProjectPaths(request.workspaceRoot);
    const draftUri: StoryUri = draftPath(request.workspaceRoot, request.sceneStem);

    const sources: DraftFormatSourcesResult = await this.loadFormatSources(paths, draftUri);
    if (!sources.ok) {
      return sources.result;
    }

    try {
      return await this.formatAndWriteDraft(request, draftUri, sources.project, sources.existing);
    } catch (error) {
      this.host.logger.error('Apply draft format failed', error);
      return failedResult(error);
    }
  }

  private async loadFormatSources(
    paths: StoryboardProjectPaths,
    draftUri: StoryUri,
  ): Promise<DraftFormatSourcesResult> {
    let project: StoryboardProject;
    try {
      project = await new ProjectRepository(this.host.fileSystem).read(paths.projectJson);
    } catch (error) {
      this.host.logger.error('Failed to read project.json', error);
      return { ok: false, result: { kind: 'project_unreadable', ok: false } };
    }

    let rawDraft: string;
    try {
      rawDraft = await readDraftFile(draftUri, this.host.fileSystem);
    } catch {
      return { ok: false, result: { kind: 'draft_missing', ok: false } };
    }

    try {
      return { ok: true, project, existing: parseDraft(rawDraft) };
    } catch (error) {
      this.host.logger.error('Failed to parse draft', error);
      return { ok: false, result: { kind: 'draft_invalid', ok: false } };
    }
  }

  private async formatAndWriteDraft(
    request: ApplyDraftFormatRequest,
    draftUri: StoryUri,
    project: StoryboardProject,
    existing: Draft,
  ): Promise<ApplyDraftFormatResult> {
    if (request.shouldCancel?.()) {
      return { kind: 'cancelled', ok: false };
    }

    const formattedBody: string = await this.ai.gateway
      .createService(request.workspaceRoot)
      .applyGenreFormat(existing.body, project.format, {
        providerId: this.ai.gateway.getTaskProvider('sceneDraft'),
        attribution: { primary: { kind: 'scene', id: request.sceneStem } },
      });

    if (request.shouldCancel?.()) {
      return { kind: 'cancelled', ok: false };
    }

    const draft: Draft = this.createFormattedDraft(existing, project, formattedBody);

    request.onSaving?.();
    await writeDraftFile(draftUri, this.host.fileSystem, draft);

    return { kind: 'formatted', ok: true, draftUri };
  }

  private createFormattedDraft(
    existing: Draft,
    project: StoryboardProject,
    formattedBody: string,
  ): Draft {
    const sceneDraftConfig: TaskAiConfigResolved = this.ai.gateway.getTaskAiConfig('sceneDraft');

    return createDraft({
      sceneStem: existing.sceneStem,
      format: project.format,
      body: formattedBody,
      generatedAt: existing.generatedAt,
      generator: this.host.generator,
      providerId: sceneDraftConfig.providerId,
      model: sceneDraftConfig.model,
    });
  }
}
