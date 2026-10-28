import type { CommandOutcome } from '@/commands/outcome';
import { failure, success } from '@/commands/outcomes';
import type { CliContainer } from '@/container';
import type { DraftAugmentScope } from '@storyboard/story-ai';
import type { AugmentDraftResult, SaveDraftEditResult } from '@storyboard/story-engine';
import { draftPath, scenePath, type StoryUri } from '@storyboard/story-model';
import { LineRange, replaceLines, sliceLines } from '@/commands/draft/draftLines';

export interface TransformedDraft {
  ok: boolean;
  text?: string;
  message: string;
}

export type LoadedDraftTarget =
  | { ok: true; body: string; target: string }
  | { ok: false; message: string };

export interface AugmentDraftRangeOptions {
  readonly scope: DraftAugmentScope;
  readonly instruction: string | undefined;
  readonly isDryRun: boolean;
  readonly appliedMessage: string;
  readonly proposedMessage: string;
  readonly failedLabel: string;
}

export class DraftRewriter {
  public constructor(private readonly container: CliContainer) {}

  public async loadDraftTarget(
    stem: string,
    range: LineRange | undefined,
  ): Promise<LoadedDraftTarget> {
    const body: string | undefined = await this.readDraftBody(stem);

    if (body === undefined) {
      return failure(`초안이 없습니다: ${stem}`);
    }

    const target: string = sliceLines(body, range);

    if (target.trim().length === 0) {
      return failure('대상 구간이 비어 있습니다.');
    }

    return { ok: true, body, target };
  }

  public async rewriteDraft(
    stem: string,
    range: LineRange | undefined,
    transform: (target: string) => Promise<TransformedDraft>,
  ): Promise<CommandOutcome> {
    const loaded: LoadedDraftTarget = await this.loadDraftTarget(stem, range);

    if (!loaded.ok) {
      return loaded;
    }

    const { body, target } = loaded;
    const transformed: TransformedDraft = await transform(target);

    if (!transformed.ok || transformed.text === undefined) {
      return failure(transformed.message);
    }

    const saved: SaveDraftEditResult = await this.container.drafts.saveEdit({
      workspaceRoot: this.container.workspaceRoot,
      sceneStem: stem,
      body: replaceLines(body, range, transformed.text),
      archivePrevious: this.container.configBridge.isKeepDraftHistoryEnabled(),
    });

    if (!saved.ok) {
      return failure(`초안이 없습니다: ${stem}`);
    }

    const draftUri: StoryUri = draftPath(this.container.workspaceRoot, stem);

    return success(transformed.message, { draft: draftUri.fsPath });
  }

  public async augmentDraftRange(
    stem: string,
    range: LineRange | undefined,
    options: AugmentDraftRangeOptions,
  ): Promise<CommandOutcome> {
    const prepare = (target: string): Promise<AugmentDraftResult> =>
      this.container.drafts.prepareAugmentation({
        draftSceneStem: stem,
        sceneUri: scenePath(this.container.workspaceRoot, stem),
        scope: options.scope,
        target,
        workspaceRoot: this.container.workspaceRoot,
        ...(options.instruction === undefined ? {} : { instruction: options.instruction }),
      });

    if (options.isDryRun) {
      const loaded: LoadedDraftTarget = await this.loadDraftTarget(stem, range);

      if (!loaded.ok) {
        return loaded;
      }

      const prepared: AugmentDraftResult = await prepare(loaded.target);

      return prepared.ok
        ? success(options.proposedMessage, prepared)
        : failure(`${options.failedLabel} (${prepared.kind}).`, prepared);
    }

    return this.rewriteDraft(stem, range, async (target) => {
      const prepared: AugmentDraftResult = await prepare(target);

      return prepared.ok
        ? { ok: true, text: prepared.text, message: options.appliedMessage }
        : failure(`${options.failedLabel} (${prepared.kind}).`);
    });
  }

  public async readDraftBody(stem: string): Promise<string | undefined> {
    try {
      return (await this.container.drafts.readDraft(this.container.workspaceRoot, stem))?.draft
        .body;
    } catch {
      return undefined;
    }
  }
}
