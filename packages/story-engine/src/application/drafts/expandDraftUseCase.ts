import type { AiServices, HostAdapters } from '#engine/application/engineServices';
import type { StoryUri } from '@storyboard/story-model';
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

export class ExpandDraftUseCase implements IUseCase<ExpandDraftRequest, ExpandDraftResult> {
  public constructor(
    private readonly host: HostAdapters,
    private readonly ai: AiServices,
  ) {}

  public async execute(request: ExpandDraftRequest): Promise<ExpandDraftResult> {
    return await runUseCase<ExpandDraftResult>(
      this.host.logger,
      'Expand draft failed',
      async () => {
        const expanded: string = await this.ai.gateway
          .createService(request.workspaceRoot)
          .expandDraft(
            request.selectedText,
            {},
            {
              providerId: this.ai.gateway.getTaskProvider('draftExpansion'),
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
