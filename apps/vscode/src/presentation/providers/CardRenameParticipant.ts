import * as vscode from 'vscode';

import type { CardManager, DraftManager } from '@storyboard/story-app';
import type {
  IStoryboardLogger,
  RenameCardResult,
  RenameSceneResult,
} from '@storyboard/story-engine';
import {
  parseBundleFolderRename,
  type BundleFolderRename,
} from '@/infrastructure/vscode/bundleFolderRename';

export interface CardRenameParticipantDependencies {
  readonly cards: Pick<CardManager, 'rename'>;
  readonly drafts: Pick<DraftManager, 'renameScene'>;
  readonly logger: IStoryboardLogger;
}

type EngineRenameOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

export class CardRenameParticipant {
  public constructor(private readonly dependencies: CardRenameParticipantDependencies) {}

  public register(): vscode.Disposable {
    return vscode.workspace.onDidRenameFiles((event) => {
      const renames: readonly BundleFolderRename[] = event.files.flatMap(
        (file) => parseBundleFolderRename(file.oldUri, file.newUri) ?? [],
      );

      if (renames.length > 0) {
        void this.redirectToEngine(renames);
      }
    });
  }

  private async redirectToEngine(renames: readonly BundleFolderRename[]): Promise<void> {
    for (const rename of renames) {
      this.dependencies.logger.info(
        `card rename participant: ${rename.kind} ${rename.fromKey} -> ${rename.toKey}`,
      );
      await vscode.workspace.fs.rename(rename.newUri, rename.oldUri, { overwrite: false });

      const outcome: EngineRenameOutcome = await this.renameThroughEngine(rename);
      if (!outcome.ok) {
        void vscode.window.showWarningMessage(
          `${rename.fromKey} 의 이름을 바꾸지 않았습니다: ${outcome.message}`,
        );
      }
    }
  }

  private async renameThroughEngine(rename: BundleFolderRename): Promise<EngineRenameOutcome> {
    if (rename.kind === 'scene') {
      const renamed: RenameSceneResult = await this.dependencies.drafts.renameScene({
        workspaceRoot: rename.workspaceRoot,
        scene: rename.fromKey,
        to: rename.toKey,
      });
      return renamed.ok ? { ok: true } : { ok: false, message: renamed.message };
    }

    const renamed: RenameCardResult = await this.dependencies.cards.rename({
      workspaceRoot: rename.workspaceRoot,
      category: rename.kind,
      fromId: rename.fromKey,
      toId: rename.toKey,
    });
    return renamed.ok ? { ok: true } : { ok: false, message: renamed.message };
  }
}
