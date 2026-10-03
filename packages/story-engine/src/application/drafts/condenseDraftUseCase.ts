import type { AiGateway } from '#engine/application/ai/aiGateway';
import type { StoryUri, ProjectFormat } from '@storyboard/story-model';
import type { IStoryboardLogger } from '#engine/ports/logger';
import { runUseCase, type IUseCase } from '#engine/application/useCase';
import {
  resolveMinimumDraftLength,
  validateDraftCandidate,
  type DraftCandidateRejectionReason,
} from '@storyboard/story-pipeline';

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

export interface CondenseDraftUseCaseDependencies {
  readonly aiGateway: AiGateway;
  readonly logger: IStoryboardLogger;
}

export class CondenseDraftUseCase implements IUseCase<CondenseDraftRequest, CondenseDraftResult> {
  public constructor(private readonly deps: CondenseDraftUseCaseDependencies) {}

  public async execute(request: CondenseDraftRequest): Promise<CondenseDraftResult> {
    // NOTE: 압축은 원고를 원본보다 짧게 만드는 작업이라 씬 목표를 하한으로 쓰면 안 된다. 목표에
    // 미달한 원고에서는 하한이 원본 길이와 같아져 어떤 압축 결과도 통과하지 못한다.
    const lengthPolicy = { maxCompressionPercent: request.maxCompressionPercent };
    const minimumLength = resolveMinimumDraftLength(request.body.length, lengthPolicy);

    return await runUseCase<CondenseDraftResult>(
      this.deps.logger,
      'Condense draft failed',
      async () => {
        const text = await this.deps.aiGateway.createService(request.workspaceRoot).condenseDraft(
          {
            body: request.body,
            format: request.format,
            targetLength: minimumLength,
            intent: request.intent,
            facts: request.facts,
            characterCards: request.characterCards,
          },
          {
            providerId: this.deps.aiGateway.getTaskProvider('draftRevision'),
            attribution: { primary: { kind: 'scene', id: request.sceneStem } },
          },
        );
        const validation = validateDraftCandidate(request.body, text, lengthPolicy, {
          requireShorter: true,
        });

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
