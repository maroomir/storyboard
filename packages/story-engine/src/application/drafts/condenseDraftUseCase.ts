import type { AiServices, HostAdapters } from '#engine/application/engineServices';
import type { StoryUri, ProjectFormat } from '@storyboard/story-model';
import { runUseCase, type IUseCase } from '#engine/application/useCase';
import {
  resolveMinimumDraftLength,
  validateDraftCandidate,
  type DraftCandidateLengthPolicy,
  type DraftCandidateRejectionReason,
  type DraftCandidateValidation,
} from '#engine/pipeline/draftCandidateValidation';

export interface CondenseDraftRequest {
  readonly workspaceRoot: StoryUri;
  readonly sceneStem: string;
  readonly format: ProjectFormat;
  readonly body: string;
  readonly maxCompressionPercent: number;
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

export class CondenseDraftUseCase implements IUseCase<CondenseDraftRequest, CondenseDraftResult> {
  public constructor(
    private readonly host: HostAdapters,
    private readonly ai: AiServices,
  ) {}

  public async execute(request: CondenseDraftRequest): Promise<CondenseDraftResult> {
    const lengthPolicy: DraftCandidateLengthPolicy = {
      maxCompressionPercent: request.maxCompressionPercent,
    };
    const minimumLength: number = resolveMinimumDraftLength(request.body.length, lengthPolicy);

    return await runUseCase<CondenseDraftResult>(
      this.host.logger,
      'Condense draft failed',
      async () => {
        const text: string = await this.ai.gateway
          .createService(request.workspaceRoot)
          .condenseDraft(
            {
              body: request.body,
              format: request.format,
              targetLength: minimumLength,
              intent: request.intent,
              facts: request.facts,
              characterCards: request.characterCards,
            },
            {
              providerId: this.ai.gateway.getTaskProvider('draftRevision'),
              attribution: { primary: { kind: 'scene', id: request.sceneStem } },
            },
          );
        const validation: DraftCandidateValidation = validateDraftCandidate(
          request.body,
          text,
          lengthPolicy,
          {
            requireShorter: true,
          },
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
      },
    );
  }
}
