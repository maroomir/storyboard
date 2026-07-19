import type * as vscode from 'vscode';

import type { AiGateway } from '../ai/aiGateway';
import type { StoryboardLogger } from '../../infrastructure/vscode/logger';
import type { ProjectFormat } from '../../shared/project';
import {
  resolveMinimumDraftLength,
  validateDraftCandidate,
  type DraftCandidateRejectionReason,
} from './draftCandidateValidation';

export interface CondenseDraftRequest {
  readonly workspaceRoot: vscode.Uri;
  readonly sceneStem: string;
  readonly format: ProjectFormat;
  readonly body: string;
  readonly maxCompressionPercent: number;
  readonly targetLength?: number;
  readonly intent?: string;
  readonly facts?: readonly string[];
  readonly characterCards?: readonly string[];
}

export type CondenseDraftResult =
  | { readonly kind: 'condensed'; readonly ok: true; readonly text: string }
  | {
      readonly kind: 'review-required';
      readonly ok: true;
      readonly text: string;
      readonly candidateLength: number;
      readonly minimumLength: number;
    }
  | {
      readonly kind: 'rejected';
      readonly ok: false;
      readonly reason: DraftCandidateRejectionReason;
      readonly candidateLength: number;
      readonly minimumLength: number;
    }
  | { readonly kind: 'failed'; readonly ok: false; readonly message: string };

export class CondenseDraftUseCase {
  public constructor(
    private readonly aiGateway: AiGateway,
    private readonly logger: StoryboardLogger,
  ) {}

  public async execute(request: CondenseDraftRequest): Promise<CondenseDraftResult> {
    const minimumLength = resolveMinimumDraftLength(request.body.length, {
      maxCompressionPercent: request.maxCompressionPercent,
      targetLength: request.targetLength,
    });

    try {
      const text = await this.aiGateway.createService(request.workspaceRoot).condenseDraft(
        {
          body: request.body,
          format: request.format,
          targetLength: minimumLength,
          intent: request.intent,
          facts: request.facts,
          characterCards: request.characterCards,
        },
        {
          providerId: this.aiGateway.getTaskProvider('draftRevision'),
          attribution: { primary: { kind: 'scene', id: request.sceneStem } },
        },
      );
      const validation = validateDraftCandidate(
        request.body,
        text,
        {
          maxCompressionPercent: request.maxCompressionPercent,
          targetLength: request.targetLength,
        },
        { requireShorter: true },
      );

      if (!validation.accepted) {
        if (validation.reason === 'too-short') {
          return {
            kind: 'review-required',
            ok: true,
            text,
            candidateLength: validation.candidateLength,
            minimumLength: validation.minimumLength,
          };
        }

        return {
          kind: 'rejected',
          ok: false,
          reason: validation.reason ?? 'empty',
          candidateLength: validation.candidateLength,
          minimumLength: validation.minimumLength,
        };
      }

      return { kind: 'condensed', ok: true, text };
    } catch (error) {
      this.logger.error('Condense draft failed', error);
      return {
        kind: 'failed',
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
