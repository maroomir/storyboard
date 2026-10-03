import type { AiGateway } from '#engine/application/ai/aiGateway';
import type { StoryUri } from '@storyboard/story-model';
import type { IStoryboardLogger } from '#engine/ports/logger';
import { runUseCase, type IUseCase } from '#engine/application/useCase';

export type ExpandDraftRequest = {
  readonly workspaceRoot: StoryUri;
  readonly selectedText: string;
  readonly sceneStem: string;
};

export type ExpandDraftResult =
  | { readonly kind: 'expanded'; readonly ok: true; readonly text: string }
  | { readonly kind: 'empty'; readonly ok: false }
  | { readonly kind: 'failed'; readonly message: string; readonly ok: false };

export interface ExpandDraftUseCaseDependencies {
  readonly aiGateway: AiGateway;
  readonly logger: IStoryboardLogger;
}

export class ExpandDraftUseCase implements IUseCase<ExpandDraftRequest, ExpandDraftResult> {
  public constructor(private readonly deps: ExpandDraftUseCaseDependencies) {}

  public async execute(request: ExpandDraftRequest): Promise<ExpandDraftResult> {
    return await runUseCase<ExpandDraftResult>(
      this.deps.logger,
      'Expand draft failed',
      async () => {
        const expanded = await this.deps.aiGateway.createService(request.workspaceRoot).expandDraft(
          request.selectedText,
          {},
          {
            providerId: this.deps.aiGateway.getTaskProvider('draftExpansion'),
            attribution: { primary: { kind: 'scene', id: request.sceneStem } },
          },
        );

        if (!expanded) {
          return { kind: 'empty', ok: false };
        }

        return { kind: 'expanded', ok: true, text: expanded };
      },
    );
  }
}
