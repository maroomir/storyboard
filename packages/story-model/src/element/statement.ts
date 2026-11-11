import { z } from 'zod';

import { isElementId } from '#model/element/elementId';
import type { ElementKind } from '#model/element/elementKind';
import type { FacetQualifierRule } from '#model/element/facet';
import {
  getStatementFacetRow,
  isStatementFacetId,
  isStatementFacetOf,
  type StatementFacetId,
} from '#model/element/facetCatalog';
import {
  isStoryStateFacetId,
  storyStateFacetRows,
  type StoryStateFacetId,
} from '#model/element/storyStateFacets';

export type StatementOrigin = 'studio' | 'interview' | 'author' | 'agent';

export const statementOrigins: readonly [StatementOrigin, ...StatementOrigin[]] = [
  'studio',
  'interview',
  'author',
  'agent',
];

export interface StatementSource {
  readonly origin: StatementOrigin;
  readonly session?: string;
  readonly command?: string;
}

export interface Statement {
  readonly facet: StatementFacetId;
  readonly value: string;
  readonly key?: string;
  readonly about?: string;
  readonly since?: string;
  readonly until?: string;
  readonly revealFrom?: string;
  readonly knownBy?: readonly string[];
  readonly keywords?: readonly string[];
  readonly source: StatementSource;
}

export interface StoryStateStatement {
  readonly facet: StoryStateFacetId;
  readonly value: string;
  readonly about?: string;
  readonly knownBy?: readonly string[];
}

export interface StatementKindIssue {
  readonly index: number;
  readonly facet: StatementFacetId;
}

const factFacetId: StatementFacetId = 'fact';

const trimmedTextSchema: z.ZodType<string> = z.string().trim().min(1);

const elementIdSchema: z.ZodType<string> = z.string().refine(isElementId, {
  message: '요소 id 는 uuid 여야 합니다.',
});

export const statementSourceSchema: z.ZodType<StatementSource> = z
  .object({
    origin: z.enum(statementOrigins),
    session: trimmedTextSchema.optional(),
    command: trimmedTextSchema.optional(),
  })
  .strict();

const statementShape = {
  facet: z.custom<StatementFacetId>(
    (value) => typeof value === 'string' && isStatementFacetId(value),
    { message: '알 수 없는 진술 facet 입니다.' },
  ),
  value: trimmedTextSchema,
  key: trimmedTextSchema.optional(),
  about: elementIdSchema.optional(),
  since: elementIdSchema.optional(),
  until: elementIdSchema.optional(),
  revealFrom: elementIdSchema.optional(),
  knownBy: z.array(elementIdSchema).readonly().optional(),
  keywords: z.array(trimmedTextSchema).readonly().optional(),
  source: statementSourceSchema,
} satisfies z.ZodRawShape;

function qualifierIssue(
  name: 'key' | 'about',
  rule: FacetQualifierRule,
  value: string | undefined,
): string | undefined {
  if (rule === 'required' && value === undefined) {
    return `이 facet 은 ${name} 가 있어야 합니다.`;
  }

  return rule === 'forbidden' && value !== undefined ? `이 facet 은 ${name} 를 받지 않습니다.` : undefined;
}

function listStatementRuleIssues(statement: Statement): readonly string[] {
  const rule: { readonly key: FacetQualifierRule; readonly about: FacetQualifierRule } =
    getStatementFacetRow(statement.facet);
  const keywordIssue: string | undefined =
    statement.keywords !== undefined && statement.facet !== factFacetId
      ? 'keywords 는 fact 진술만 받습니다.'
      : undefined;

  return [
    qualifierIssue('key', rule.key, statement.key),
    qualifierIssue('about', rule.about, statement.about),
    keywordIssue,
  ].filter((issue): issue is string => issue !== undefined);
}

export const statementSchema: z.ZodType<Statement> = z
  .object(statementShape)
  .strict()
  .superRefine((statement, context) => {
    for (const message of listStatementRuleIssues(statement)) {
      context.addIssue({ code: 'custom', message });
    }
  });

export const statementListSchema: z.ZodType<readonly Statement[]> = z.array(statementSchema).readonly();

export const storyStateStatementSchema: z.ZodType<StoryStateStatement> = z
  .object({
    facet: z.custom<StoryStateFacetId>(
      (value) => typeof value === 'string' && isStoryStateFacetId(value),
      { message: '알 수 없는 상태 facet 입니다.' },
    ),
    value: trimmedTextSchema,
    about: elementIdSchema.optional(),
    knownBy: z.array(elementIdSchema).readonly().optional(),
  })
  .strict()
  .superRefine((statement, context) => {
    const isAboutForbidden: boolean =
      storyStateFacetRows.find((row) => row.id === statement.facet)?.about === 'forbidden';
    if (isAboutForbidden && statement.about !== undefined) {
      context.addIssue({ code: 'custom', message: '이 상태 facet 은 about 를 받지 않습니다.' });
    }
  });

export function findStatementsOutsideKind(
  kind: ElementKind,
  statements: readonly Statement[],
): readonly StatementKindIssue[] {
  return statements.flatMap((statement, index): StatementKindIssue[] =>
    isStatementFacetOf(statement.facet, kind) ? [] : [{ index, facet: statement.facet }],
  );
}

export function isAuthorStatement(statement: Statement): boolean {
  return statement.source.origin === 'author';
}
