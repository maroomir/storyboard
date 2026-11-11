import {
  isStatementFacetId,
  isStatementFacetOf,
  mergeStatements,
  statementSchema,
  type ElementKind,
  type Statement,
  type StatementMergeResult,
  type StatementOrigin,
  type StoryUri,
} from '@storyboard/story-model';
import type { z } from 'zod';

import type { IUseCase } from '#engine/application/useCase';
import type { ElementBundle } from '#engine/persistence/bundles/elementBundleRepository';
import type { CardRoster, WorkspaceCards } from '#engine/persistence/bundles/workspaceCards';

export type CardStatementOrigin = Extract<StatementOrigin, 'author' | 'agent'>;

export interface SetCardStatementRequest {
  readonly workspaceRoot: StoryUri;
  readonly slug: string;
  readonly facet: string;
  readonly value: string;
  readonly key?: string;
  readonly about?: string;
  readonly origin: CardStatementOrigin;
}

export type SetCardStatementResult =
  | { readonly ok: true; readonly kind: 'added' | 'replaced' | 'unchanged'; readonly path: string }
  | {
      readonly ok: false;
      readonly kind: 'missing' | 'invalid' | 'held-by-author';
      readonly message: string;
    };

const aboutTargetKinds: readonly ElementKind[] = ['character', 'background', 'narrator'];

export function resolveCardSlug(roster: CardRoster, slug: string): string | undefined {
  return aboutTargetKinds
    .map((kind) => roster.lookup.idOf(kind, slug))
    .find((id): id is string => id !== undefined);
}

export class SetCardStatementUseCase
  implements IUseCase<SetCardStatementRequest, SetCardStatementResult>
{
  public constructor(private readonly cards: WorkspaceCards) {}

  public async execute(request: SetCardStatementRequest): Promise<SetCardStatementResult> {
    const bundle: ElementBundle | undefined = await this.cards.findBundleBySlug(
      request.workspaceRoot,
      request.slug,
    );
    if (bundle === undefined) {
      return { ok: false, kind: 'missing', message: `카드가 없습니다: ${request.slug}` };
    }

    const statement: Statement | string = await this.buildStatement(request, bundle);
    if (typeof statement === 'string') {
      return { ok: false, kind: 'invalid', message: statement };
    }

    const merged: StatementMergeResult = mergeStatements(bundle.statements, [statement]);
    if (merged.heldByAuthor.length > 0) {
      return {
        ok: false,
        kind: 'held-by-author',
        message: `작가가 쓴 줄이라 바꾸지 않았습니다: ${request.slug} ${request.facet}`,
      };
    }

    await this.cards.rewriteBundle(request.workspaceRoot, bundle, {
      header: bundle.header,
      statements: merged.statements,
    });
    return { ok: true, kind: this.outcomeOf(merged), path: bundle.path };
  }

  private async buildStatement(
    request: SetCardStatementRequest,
    bundle: ElementBundle,
  ): Promise<Statement | string> {
    if (!isStatementFacetId(request.facet) || !isStatementFacetOf(request.facet, bundle.header.kind)) {
      return `${bundle.header.kind} 카드에 없는 항목입니다: ${request.facet}`;
    }

    const about: string | undefined =
      request.about === undefined
        ? undefined
        : resolveCardSlug(await this.cards.loadRoster(request.workspaceRoot), request.about);
    if (request.about !== undefined && about === undefined) {
      return `가리킬 카드가 없습니다: ${request.about}`;
    }

    const parsed: z.ZodSafeParseResult<Statement> = statementSchema.safeParse({
      facet: request.facet,
      value: request.value,
      ...(request.key === undefined ? {} : { key: request.key }),
      ...(about === undefined ? {} : { about }),
      source: { origin: request.origin, command: 'card set' },
    });

    return parsed.success
      ? parsed.data
      : parsed.error.issues.map((issue) => issue.message).join(' ');
  }

  private outcomeOf(merged: StatementMergeResult): 'added' | 'replaced' | 'unchanged' {
    if (merged.added.length > 0) {
      return 'added';
    }

    return merged.replaced.length > 0 ? 'replaced' : 'unchanged';
  }
}
