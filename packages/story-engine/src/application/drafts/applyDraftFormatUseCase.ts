import type { IFileSystem } from '#engine/ports/fileSystem';
import type { AiGateway } from '#engine/application/ai/aiGateway';
import type { StoryUri } from '@storyboard/story-model';
import type { IStoryboardLogger } from '#engine/ports/logger';
import { failedResult, type IUseCase } from '#engine/application/useCase';
import { draftPath, getStoryboardProjectPaths } from '#engine/paths/projectPaths';
import { createDraft, parseDraft, readDraftFile, writeDraftFile } from '@storyboard/story-model';
import { readProjectJson } from '#engine/persistence/projectJson';

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

export interface ApplyDraftFormatUseCaseDependencies {
  readonly fileSystem: IFileSystem;
  readonly aiGateway: AiGateway;
  readonly logger: IStoryboardLogger;
  readonly generator: string;
}

export class ApplyDraftFormatUseCase implements IUseCase<
  ApplyDraftFormatRequest,
  ApplyDraftFormatResult
> {
  public constructor(private readonly deps: ApplyDraftFormatUseCaseDependencies) {}

  public async execute(request: ApplyDraftFormatRequest): Promise<ApplyDraftFormatResult> {
    const paths = getStoryboardProjectPaths(request.workspaceRoot);
    const draftUri = draftPath(request.workspaceRoot, request.sceneStem);

    let project;
    try {
      project = await readProjectJson(this.deps.fileSystem, paths.projectJson);
    } catch (error) {
      this.deps.logger.error('Failed to read project.json', error);
      return { kind: 'project_unreadable', ok: false };
    }

    let rawDraft: string;
    try {
      rawDraft = await readDraftFile(draftUri, this.deps.fileSystem);
    } catch {
      return { kind: 'draft_missing', ok: false };
    }

    let existing;
    try {
      existing = parseDraft(rawDraft);
    } catch (error) {
      this.deps.logger.error('Failed to parse draft', error);
      return { kind: 'draft_invalid', ok: false };
    }

    try {
      if (request.shouldCancel?.()) {
        return { kind: 'cancelled', ok: false };
      }

      const formattedBody = await this.deps.aiGateway
        .createService(request.workspaceRoot)
        .applyGenreFormat(existing.body, project.format, {
          providerId: this.deps.aiGateway.getTaskProvider('sceneDraft'),
          attribution: { primary: { kind: 'scene', id: request.sceneStem } },
        });

      if (request.shouldCancel?.()) {
        return { kind: 'cancelled', ok: false };
      }

      const sceneDraftConfig = this.deps.aiGateway.getTaskAiConfig('sceneDraft');
      const draft = createDraft({
        sceneStem: existing.sceneStem,
        format: project.format,
        body: formattedBody,
        generatedAt: existing.generatedAt,
        generator: this.deps.generator,
        providerId: sceneDraftConfig.providerId,
        model: sceneDraftConfig.model,
      });

      request.onSaving?.();
      await writeDraftFile(draftUri, this.deps.fileSystem, draft);

      return { kind: 'formatted', ok: true, draftUri };
    } catch (error) {
      this.deps.logger.error('Apply draft format failed', error);
      return failedResult(error);
    }
  }
}
