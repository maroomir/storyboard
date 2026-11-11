import type { HostAdapters } from '#engine/application/engineServices';
import { cardIdPattern, type BibleSubjectKind, type StoryUri } from '@storyboard/story-model';

import { runUseCase, type IUseCase, type UseCaseFailure } from '#engine/application/useCase';
export interface RenameCardRequest {
  readonly workspaceRoot: StoryUri;
  readonly category: BibleSubjectKind;
  readonly fromId: string;
  readonly toId: string;
}

export type RenameCardResult =
  | {
      readonly ok: true;
      readonly kind: 'renamed';
      readonly fromId: string;
      readonly toId: string;
      readonly rewrittenCount: number;
      readonly unreadableFiles: readonly string[];
    }
  | {
      readonly ok: false;
      readonly kind: 'invalid-id' | 'missing' | 'exists';
      readonly message: string;
    }
  | UseCaseFailure;

export interface ReferenceRewrite {
  readonly rewrittenCount: number;
  readonly unreadableFiles: readonly string[];
}

const referencesFollowTheUuid: ReferenceRewrite = { rewrittenCount: 0, unreadableFiles: [] };

export class RenameCardUseCase implements IUseCase<RenameCardRequest, RenameCardResult> {
  public constructor(private readonly host: HostAdapters) {}

  public async execute(request: RenameCardRequest): Promise<RenameCardResult> {
    return await runUseCase<RenameCardResult>(this.host.logger, 'Rename card failed', () =>
      this.rename(request),
    );
  }

  private async rename(request: RenameCardRequest): Promise<RenameCardResult> {
    const { cards } = this.host;
    const { workspaceRoot, category, fromId, toId } = request;

    if (!cardIdPattern.test(toId)) {
      return {
        ok: false,
        kind: 'invalid-id',
        message: 'ID 는 영문 소문자, 숫자, 하이픈만 쓸 수 있고 숫자나 문자로 시작해야 합니다.',
      };
    }

    if (!(await cards.exists(workspaceRoot, category, fromId))) {
      return { ok: false, kind: 'missing', message: `카드가 없습니다: ${fromId}` };
    }

    if (await cards.exists(workspaceRoot, category, toId)) {
      return { ok: false, kind: 'exists', message: `이미 있습니다: ${toId}` };
    }

    await cards.rename(workspaceRoot, category, fromId, toId);

    return {
      ok: true,
      kind: 'renamed',
      fromId,
      toId,
      ...referencesFollowTheUuid,
    };
  }
}
