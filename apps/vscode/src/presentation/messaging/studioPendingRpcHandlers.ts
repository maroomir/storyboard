import type * as vscode from 'vscode';

import type { CardManager } from '@storyboard/story-app';
import type { CardPendingApplyReport, CardPendingResult } from '@storyboard/story-engine';
import type {
  CardPendingChangeView,
  StoryboardRequestPayload,
  StoryboardResponsePayload,
} from '@storyboard/story-model';
import type { StoryboardRpcHandlers } from '@/presentation/messaging/bridge';

export interface StudioPendingRpcDependencies {
  readonly cards: Pick<CardManager, 'readPendingView' | 'applyPending' | 'discardPending'>;
  readonly getProjectRoot: () => Promise<vscode.Uri | undefined>;
}

const missingProjectMessage: string = 'Storyboard 프로젝트를 먼저 열어 주세요.';

export function describeAppliedPending(report: CardPendingApplyReport): string {
  return [
    `${report.applied}줄을 적용했어요.`,
    report.heldByAuthor.length === 0
      ? undefined
      : `작가가 쓴 줄과 겹친 ${report.heldByAuthor.length}줄은 그대로 뒀어요.`,
    report.failures.length === 0 ? undefined : `적용하지 못한 제안: ${report.failures.join(' / ')}`,
  ]
    .filter((part): part is string => part !== undefined)
    .join(' ');
}

export class StudioPendingRpc {
  public constructor(private readonly deps: StudioPendingRpcDependencies) {}

  public handlers(): StoryboardRpcHandlers {
    return {
      'cards.pending.list': this.list,
      'cards.pending.apply': this.apply,
      'cards.pending.discard': this.discard,
    };
  }

  private readonly list = async (
    payload: StoryboardRequestPayload<'cards.pending.list'>,
  ): Promise<StoryboardResponsePayload<'cards.pending.list'>> => {
    const root: vscode.Uri | undefined = await this.deps.getProjectRoot();
    if (!root) {
      return { ok: false, message: missingProjectMessage, changes: [] };
    }

    const pending: CardPendingResult<readonly CardPendingChangeView[]> =
      await this.deps.cards.readPendingView(root, payload.slug);
    return pending.ok
      ? { ok: true, changes: [...pending.report] }
      : { ok: false, message: pending.message, changes: [] };
  };

  private readonly apply = async (
    payload: StoryboardRequestPayload<'cards.pending.apply'>,
  ): Promise<StoryboardResponsePayload<'cards.pending.apply'>> => {
    const root: vscode.Uri | undefined = await this.deps.getProjectRoot();
    if (!root) {
      return { ok: false, message: missingProjectMessage };
    }

    const applied: CardPendingResult<CardPendingApplyReport> = await this.deps.cards.applyPending(
      root,
      payload.slug,
    );
    return applied.ok
      ? {
          ok: applied.report.failures.length === 0,
          message: describeAppliedPending(applied.report),
        }
      : { ok: false, message: applied.message };
  };

  private readonly discard = async (
    payload: StoryboardRequestPayload<'cards.pending.discard'>,
  ): Promise<StoryboardResponsePayload<'cards.pending.discard'>> => {
    const root: vscode.Uri | undefined = await this.deps.getProjectRoot();
    if (!root) {
      return { ok: false, message: missingProjectMessage };
    }

    const discarded: CardPendingResult<{ readonly discarded: number }> =
      await this.deps.cards.discardPending(root, payload.slug);
    return discarded.ok
      ? { ok: true, message: `제안 ${discarded.report.discarded}건을 버렸어요.` }
      : { ok: false, message: discarded.message };
  };
}
