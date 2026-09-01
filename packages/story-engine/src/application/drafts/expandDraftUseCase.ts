import type { AiGateway } from '../ai/aiGateway';
import type { StoryUri } from '@storyboard/story-format';
import type { IStoryboardLogger } from '../../ports/logger';

export type ExpandDraftRequest = {
  readonly workspaceRoot: StoryUri;
  readonly selectedText: string;
  readonly sceneStem: string;
};

export type ExpandDraftResult =
  | { readonly kind: 'expanded'; readonly ok: true; readonly text: string }
  | { readonly kind: 'empty'; readonly ok: false }
  | { readonly kind: 'failed'; readonly message: string; readonly ok: false };

export class ExpandDraftUseCase {
  public constructor(
    private readonly aiGateway: AiGateway,
    private readonly logger: IStoryboardLogger,
  ) {}

  public async execute(request: ExpandDraftRequest): Promise<ExpandDraftResult> {
    try {
      const expanded = await this.aiGateway.createService(request.workspaceRoot).expandDraft(
        request.selectedText,
        {},
        {
          providerId: this.aiGateway.getTaskProvider('draftExpansion'),
          attribution: { primary: { kind: 'scene', id: request.sceneStem } },
        },
      );

      if (!expanded) {
        return { kind: 'empty', ok: false };
      }

      return { kind: 'expanded', ok: true, text: expanded };
    } catch (error) {
      this.logger.error('Expand draft failed', error);
      return {
        kind: 'failed',
        message: error instanceof Error ? error.message : String(error),
        ok: false,
      };
    }
  }
}
