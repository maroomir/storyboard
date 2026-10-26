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
import { readProjectJson } from '#engine/persistence/projectJson';
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

    let project: StoryboardProject;
    try {
      project = await readProjectJson(this.host.fileSystem, paths.projectJson);
    } catch (error) {
      this.host.logger.error('Failed to read project.json', error);
      return { kind: 'project_unreadable', ok: false };
    }

    let rawDraft: string;
    try {
      rawDraft = await readDraftFile(draftUri, this.host.fileSystem);
    } catch {
      return { kind: 'draft_missing', ok: false };
    }

    let existing: Draft;
    try {
      existing = parseDraft(rawDraft);
    } catch (error) {
      this.host.logger.error('Failed to parse draft', error);
      return { kind: 'draft_invalid', ok: false };
    }

    try {
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

      const sceneDraftConfig: TaskAiConfigResolved = this.ai.gateway.getTaskAiConfig('sceneDraft');
      const draft: Draft = createDraft({
        sceneStem: existing.sceneStem,
        format: project.format,
        body: formattedBody,
        generatedAt: existing.generatedAt,
        generator: this.host.generator,
        providerId: sceneDraftConfig.providerId,
        model: sceneDraftConfig.model,
      });

      request.onSaving?.();
      await writeDraftFile(draftUri, this.host.fileSystem, draft);

      return { kind: 'formatted', ok: true, draftUri };
    } catch (error) {
      this.host.logger.error('Apply draft format failed', error);
      return failedResult(error);
    }
  }
}
