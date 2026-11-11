import { isSameStatementText, type Statement, type StoryUri } from '@storyboard/story-model';

import type { IUseCase } from '#engine/application/useCase';
import { resolveCardSlug } from '#engine/application/cards/setCardStatementUseCase';
import type { ElementBundle } from '#engine/persistence/bundles/elementBundleRepository';
import type { WorkspaceCards } from '#engine/persistence/bundles/workspaceCards';

export interface UnsetCardStatementRequest {
  readonly workspaceRoot: StoryUri;
  readonly slug: string;
  readonly facet: string;
  readonly key?: string;
  readonly about?: string;
  readonly value?: string;
}

export type UnsetCardStatementResult =
  | { readonly ok: true; readonly kind: 'removed'; readonly removed: readonly Statement[] }
  | { readonly ok: false; readonly kind: 'missing'; readonly message: string };

export class UnsetCardStatementUseCase
  implements IUseCase<UnsetCardStatementRequest, UnsetCardStatementResult>
{
  public constructor(private readonly cards: WorkspaceCards) {}

  public async execute(request: UnsetCardStatementRequest): Promise<UnsetCardStatementResult> {
    const bundle: ElementBundle | undefined = await this.cards.findBundleBySlug(
      request.workspaceRoot,
      request.slug,
    );
    if (bundle === undefined) {
      return { ok: false, kind: 'missing', message: `카드가 없습니다: ${request.slug}` };
    }

    const about: string | undefined =
      request.about === undefined
        ? undefined
        : resolveCardSlug(await this.cards.loadRoster(request.workspaceRoot), request.about);
    const isTarget = (statement: Statement): boolean =>
      statement.facet === request.facet &&
      (request.key === undefined || statement.key === request.key) &&
      (request.about === undefined || statement.about === about) &&
      (request.value === undefined || isSameStatementText(statement.value, request.value));
    const removed: readonly Statement[] = bundle.statements.filter(isTarget);
    if (removed.length === 0) {
      return { ok: false, kind: 'missing', message: `지울 줄이 없습니다: ${request.slug} ${request.facet}` };
    }

    await this.cards.rewriteBundle(request.workspaceRoot, bundle, {
      header: bundle.header,
      statements: bundle.statements.filter((statement) => !isTarget(statement)),
    });
    return { ok: true, kind: 'removed', removed };
  }
}
