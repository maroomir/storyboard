import type { StudioManager } from '@storyboard/story-app';
import type * as vscode from 'vscode';

import type { StudioProposalPreparation } from '@storyboard/story-engine';
import type { StoryboardRpcHandlers } from '@/presentation/messaging/bridge';
import type { ProposalReviewService } from '@/presentation/providers/proposalReviewService';
import type { StoryboardResponsePayload } from '@storyboard/story-model';

export interface StudioProposalRpcHandlersDependencies {
  readonly reviewService: ProposalReviewService;
  readonly studio: Pick<StudioManager, 'prepareProposal' | 'applyProposal'>;
  readonly getProjectRoot: () => Promise<vscode.Uri | undefined>;
}

const missingProjectMessage: string = 'Storyboard 프로젝트를 먼저 열어 주세요.';

export class StudioProposalRpc {
  public constructor(private readonly deps: StudioProposalRpcHandlersDependencies) {}

  public handlers(): StoryboardRpcHandlers {
    return {
      'studio.proposal.preview': async (
        payload,
      ): Promise<StoryboardResponsePayload<'studio.proposal.preview'>> => {
        const root: vscode.Uri | undefined = await this.deps.getProjectRoot();
        if (!root) {
          return { shown: false, message: missingProjectMessage };
        }

        const prepared: StudioProposalPreparation = await this.deps.studio.prepareProposal(
          root,
          payload.entity,
          payload.turn,
        );
        if (!prepared.ok) {
          return { shown: false, message: prepared.message };
        }

        await this.deps.reviewService.showDiffs([
          {
            original: prepared.targetUri as vscode.Uri,
            proposedText: prepared.text,
            label: `Studio 제안 · ${prepared.targetFile}`,
            key: `studio:${payload.entity.kind}:${payload.entity.key}`,
          },
        ]);

        return { shown: true };
      },

      'studio.proposal.apply': async (
        payload,
      ): Promise<StoryboardResponsePayload<'studio.proposal.apply'>> => {
        const root: vscode.Uri | undefined = await this.deps.getProjectRoot();
        if (!root) {
          return { status: 'failed', message: missingProjectMessage };
        }

        return await this.deps.studio.applyProposal(root, payload.entity, payload.turn);
      },
    };
  }
}
