import type * as vscode from 'vscode';

import type { AiGateway } from '../ai/aiGateway';
import type { StoryboardLogger } from '../../infrastructure/vscode/logger';
import { draftPath, getStoryboardProjectPaths } from '../../infrastructure/vscode/pathConventions';
import { vscodeFsAdapter } from '../../infrastructure/vscode/workspaceFsAdapters';
import { createDraft, parseDraft, readDraftFile, writeDraftFile } from '@storyboard/story-format';
import { readProjectJson } from '../../infrastructure/persistence/projectJson';

export type ApplyDraftFormatRequest = {
  readonly workspaceRoot: vscode.Uri;
  readonly sceneStem: string;
  readonly onSaving?: () => void;
  readonly shouldCancel?: () => boolean;
};

export type ApplyDraftFormatResult =
  | { readonly kind: 'formatted'; readonly ok: true; readonly draftUri: vscode.Uri }
  | { readonly kind: 'cancelled'; readonly ok: false }
  | { readonly kind: 'project_unreadable'; readonly ok: false }
  | { readonly kind: 'draft_missing'; readonly ok: false }
  | { readonly kind: 'draft_invalid'; readonly ok: false }
  | { readonly kind: 'failed'; readonly message: string; readonly ok: false };

export class ApplyDraftFormatUseCase {
  public constructor(
    private readonly aiGateway: AiGateway,
    private readonly logger: StoryboardLogger,
  ) {}

  public async execute(request: ApplyDraftFormatRequest): Promise<ApplyDraftFormatResult> {
    const paths = getStoryboardProjectPaths(request.workspaceRoot);
    const draftUri = draftPath(request.workspaceRoot, request.sceneStem);

    let project;
    try {
      project = await readProjectJson(paths.projectJson);
    } catch (error) {
      this.logger.error('Failed to read project.json', error);
      return { kind: 'project_unreadable', ok: false };
    }

    let rawDraft: string;
    try {
      rawDraft = await readDraftFile(draftUri, vscodeFsAdapter);
    } catch {
      return { kind: 'draft_missing', ok: false };
    }

    let existing;
    try {
      existing = parseDraft(rawDraft);
    } catch (error) {
      this.logger.error('Failed to parse draft', error);
      return { kind: 'draft_invalid', ok: false };
    }

    try {
      if (request.shouldCancel?.()) {
        return { kind: 'cancelled', ok: false };
      }

      const formattedBody = await this.aiGateway
        .createService(request.workspaceRoot)
        .applyGenreFormat(existing.body, project.format, {
          providerId: this.aiGateway.getTaskProvider('sceneDraft'),
          attribution: { primary: { kind: 'scene', id: request.sceneStem } },
        });

      if (request.shouldCancel?.()) {
        return { kind: 'cancelled', ok: false };
      }

      const draft = createDraft({
        sceneStem: existing.sceneStem,
        format: project.format,
        body: formattedBody,
        generatedAt: existing.generatedAt,
      });

      request.onSaving?.();
      await writeDraftFile(draftUri, vscodeFsAdapter, draft);

      return { kind: 'formatted', ok: true, draftUri };
    } catch (error) {
      this.logger.error('Apply draft format failed', error);
      return {
        kind: 'failed',
        message: error instanceof Error ? error.message : String(error),
        ok: false,
      };
    }
  }
}
