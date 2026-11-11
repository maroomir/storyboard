import { isSingleValuedShape, type StatementFacetRow } from '#model/element/facet';
import { getStatementFacetRow, type StatementFacetId } from '#model/element/facetCatalog';
import { isAuthorStatement, type Statement } from '#model/element/statement';
import { isSameStatementText } from '#model/element/statementText';

export interface StatementMergeResult {
  readonly statements: readonly Statement[];
  readonly added: readonly Statement[];
  readonly replaced: readonly Statement[];
  readonly heldByAuthor: readonly Statement[];
  readonly unchanged: readonly Statement[];
}

type StatementMergeOutcome = 'added' | 'replaced' | 'heldByAuthor' | 'unchanged';

function hasOneLinePerSlot(statement: Statement): boolean {
  const row: StatementFacetRow<StatementFacetId> = getStatementFacetRow(statement.facet);
  const isKeyedWithoutKey: boolean = row.shape === 'keyed' && statement.key === undefined;

  return isSingleValuedShape(row.shape) && !isKeyedWithoutKey;
}

function isSameSlot(left: Statement, right: Statement): boolean {
  return left.facet === right.facet && left.key === right.key && left.about === right.about;
}

function isSameLine(left: Statement, right: Statement): boolean {
  return isSameSlot(left, right) && isSameStatementText(left.value, right.value);
}

function isSameList(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  const leftItems: readonly string[] = [...(left ?? [])].sort();
  const rightItems: readonly string[] = [...(right ?? [])].sort();

  return (
    leftItems.length === rightItems.length &&
    leftItems.every((item, index) => item === rightItems[index])
  );
}

function hasSameContent(left: Statement, right: Statement): boolean {
  return (
    isSameLine(left, right) &&
    left.since === right.since &&
    left.until === right.until &&
    left.revealFrom === right.revealFrom &&
    isSameList(left.knownBy, right.knownBy) &&
    isSameList(left.keywords, right.keywords)
  );
}

function findMatchingLineIndex(statements: readonly Statement[], incoming: Statement): number {
  const isMatching: (existing: Statement) => boolean = hasOneLinePerSlot(incoming)
    ? (existing): boolean => isSameSlot(existing, incoming)
    : (existing): boolean => isSameLine(existing, incoming);

  return statements.findIndex(isMatching);
}

function decideOutcome(
  existing: Statement | undefined,
  incoming: Statement,
): StatementMergeOutcome {
  if (existing === undefined) {
    return 'added';
  }

  if (isAuthorStatement(existing) && !isAuthorStatement(incoming)) {
    return 'heldByAuthor';
  }

  const isAuthorTakingOver: boolean = isAuthorStatement(incoming) && !isAuthorStatement(existing);

  return hasSameContent(existing, incoming) && !isAuthorTakingOver ? 'unchanged' : 'replaced';
}

export function mergeStatements(
  current: readonly Statement[],
  incoming: readonly Statement[],
): StatementMergeResult {
  const statements: Statement[] = [...current];
  const outcomes: Record<StatementMergeOutcome, Statement[]> = {
    added: [],
    replaced: [],
    heldByAuthor: [],
    unchanged: [],
  };

  for (const statement of incoming) {
    const matchingIndex: number = findMatchingLineIndex(statements, statement);
    const outcome: StatementMergeOutcome = decideOutcome(statements[matchingIndex], statement);

    if (outcome === 'added') {
      statements.push(statement);
    } else if (outcome === 'replaced') {
      statements[matchingIndex] = statement;
    }

    outcomes[outcome].push(statement);
  }

  return { statements, ...outcomes };
}
