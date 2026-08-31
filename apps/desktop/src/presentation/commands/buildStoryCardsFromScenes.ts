import * as vscode from 'vscode';

import {
  applyStoryCardChanges,
  type BuildStoryCardsUseCase,
  type StoryCardTarget,
} from '@/application/story/buildStoryCardsUseCase';
import { parseCard, serializeCard } from '@storyboard/story-format';
import type { StoryboardCard } from '@storyboard/story-format';
import { backgroundCardPath, characterCardPath } from '@storyboard/story-engine';
import type { ProposalReviewService } from '@/presentation/providers/proposalReviewService';
import type { CardCollectProposal } from '@storyboard/story-engine';
const buildStoryCardsCommand = 'storyboard.cards.buildFromScenes';

interface SelectedChange {
  readonly target: StoryCardTarget;
  readonly proposal: CardCollectProposal;
}

interface PreparedCardChange {
  readonly target: StoryCardTarget;
  readonly card: StoryboardCard;
  readonly uri: vscode.Uri;
}

interface StoryChangePick extends vscode.QuickPickItem {
  readonly target: StoryCardTarget;
  readonly proposal?: CardCollectProposal;
}

export function registerBuildStoryCardsFromScenesCommand(
  context: vscode.ExtensionContext,
  useCase: BuildStoryCardsUseCase,
  reviewService: ProposalReviewService,
): vscode.Disposable {
  return vscode.commands.registerCommand(buildStoryCardsCommand, async (): Promise<void> => {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!workspaceRoot) {
      await vscode.window.showErrorMessage('Storyboard 프로젝트 작업 공간을 열어주세요.');
      return;
    }

    try {
      const proposal = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: '씬에서 카드 제안을 구성 중...',
          cancellable: true,
        },
        async (_progress, token) => {
          const result = await useCase.execute(workspaceRoot);
          if (token.isCancellationRequested) {
            throw new StoryCardBuildCancelledError();
          }
          return result;
        },
      );
      const selected = await selectChanges(proposal.targets);
      if (selected.length === 0) {
        return;
      }
      const prepared = await prepareChanges(workspaceRoot, selected);
      if (!prepared) {
        return;
      }
      await reviewService.showDiffs(
        prepared.map((change) => ({
          original: change.target.isNew ? undefined : change.uri,
          proposedText: serializeCard(change.card),
          key: `cards-${change.card.type}-${change.card.id}`,
          label: `${change.card.name} ↔ 카드 제안`,
        })),
      );
      const confirmation = await vscode.window.showWarningMessage(
        `${prepared.length}개 카드에 선택한 필드만 적용합니다. 기존 사실은 삭제하지 않습니다.`,
        { modal: true },
        '적용',
      );
      if (confirmation !== '적용') {
        return;
      }
      if (!(await useCase.hasCurrentSources(proposal.snapshots))) {
        await vscode.window.showWarningMessage(
          '검토 중 소스 또는 카드 구성이 변경되었습니다. Regenerate로 다시 제안해주세요.',
        );
        return;
      }
      const edit = new vscode.WorkspaceEdit();
      for (const change of prepared) {
        const text = serializeCard(change.card);
        if (change.target.isNew) {
          edit.createFile(change.uri, { overwrite: false, ignoreIfExists: false });
          edit.insert(change.uri, new vscode.Position(0, 0), text);
          continue;
        }
        const document = await vscode.workspace.openTextDocument(change.uri);
        edit.replace(
          change.uri,
          new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)),
          text,
        );
      }
      if (!(await vscode.workspace.applyEdit(edit))) {
        await vscode.window.showErrorMessage(
          '카드 변경을 적용하지 못했습니다. 파일은 변경되지 않았을 수 있습니다.',
        );
        return;
      }
      for (const change of prepared) {
        parseCard(new TextDecoder().decode(await vscode.workspace.fs.readFile(change.uri)));
      }
      await vscode.window.showInformationMessage(
        `씬 기반 카드 변경 ${prepared.length}개를 적용했습니다.`,
      );
    } catch (error) {
      if (error instanceof StoryCardBuildCancelledError) {
        return;
      }
      await vscode.window.showErrorMessage(
        `씬 기반 카드 제안을 만들지 못했습니다: ${messageOf(error)}`,
      );
    }
  });
}

async function selectChanges(targets: readonly StoryCardTarget[]): Promise<SelectedChange[]> {
  const items: StoryChangePick[] = targets.flatMap((target): StoryChangePick[] => {
    if (target.isNew) {
      return [
        {
          label: `새 ${target.card.type === 'character' ? '캐릭터' : '장소'} · ${target.card.name}`,
          description: target.sourceScenes.join(', '),
          target,
          proposal: undefined,
        },
      ];
    }
    return target.changes.map((change) => ({
      label: `${target.card.name} · ${change.label}`,
      description: change.proposal.sourceScenes.join(', '),
      target,
      proposal: change.proposal,
    }));
  });
  const picked = await vscode.window.showQuickPick(items, {
    title: '씬 근거 카드 변경 선택',
    placeHolder: '적용할 필드만 선택하세요.',
    canPickMany: true,
  });
  if (!picked) {
    return [];
  }
  return picked.flatMap((item) =>
    item.proposal
      ? [{ target: item.target, proposal: item.proposal }]
      : item.target.changes.map((change) => ({ target: item.target, proposal: change.proposal })),
  );
}

async function prepareChanges(
  workspaceRoot: vscode.Uri,
  selected: readonly SelectedChange[],
): Promise<PreparedCardChange[] | undefined> {
  const byTarget = new Map<string, { target: StoryCardTarget; proposals: CardCollectProposal[] }>();
  for (const change of selected) {
    const current = byTarget.get(change.target.uriId) ?? { target: change.target, proposals: [] };
    current.proposals.push(change.proposal);
    byTarget.set(change.target.uriId, current);
  }
  const usedIds = new Set<string>();
  for (const item of byTarget.values()) {
    if (!item.target.isNew) {
      usedIds.add(item.target.card.id);
    }
  }
  const prepared: PreparedCardChange[] = [];
  for (const { target, proposals } of byTarget.values()) {
    let card = applyStoryCardChanges(target, proposals);
    if (target.isNew && target.requiresIdConfirmation) {
      const id = await askForCardId(card.name, usedIds);
      if (!id) {
        return undefined;
      }
      card = { ...card, id } as StoryboardCard;
    }
    if (usedIds.has(card.id)) {
      const id = await askForCardId(card.name, usedIds);
      if (!id) {
        return undefined;
      }
      card = { ...card, id } as StoryboardCard;
    }
    usedIds.add(card.id);
    const uri =
      card.type === 'character'
        ? characterCardPath(workspaceRoot, card.id)
        : backgroundCardPath(workspaceRoot, card.id);
    prepared.push({ target, card, uri });
  }
  return prepared;
}

async function askForCardId(
  name: string,
  usedIds: ReadonlySet<string>,
): Promise<string | undefined> {
  return await vscode.window.showInputBox({
    title: `새 카드 ID · ${name}`,
    prompt: '소문자 영문, 숫자, 하이픈으로 고유 ID를 입력하세요.',
    validateInput: (value) => {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) {
        return 'ID는 소문자 영문, 숫자, 하이픈만 사용할 수 있습니다.';
      }
      return usedIds.has(value) ? '이미 사용 중인 ID입니다.' : undefined;
    },
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class StoryCardBuildCancelledError extends Error {}
