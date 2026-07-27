import type { ContinuityIssueLike, DraftCritiqueIssue, Severity } from '@storyboard/story-ai';

export const reviewAgents = ['canon', 'persona', 'narrator', 'setting'] as const;

export type ReviewAgent = (typeof reviewAgents)[number];

export const reviewCategories = [
  'voice',
  'purpose',
  'repetition',
  'continuity',
  'grammar',
] as const;

export type ReviewCategory = (typeof reviewCategories)[number];

export interface IssueTarget {
  readonly agent: ReviewAgent;
  readonly cardId?: string;
}

export interface ReviewIssue {
  readonly severity: Severity;
  readonly category: ReviewCategory;
  readonly target?: IssueTarget;
  readonly note: string;
}

export interface RoutedIssueGroup {
  readonly agent: ReviewAgent;
  readonly cardIds: readonly string[];
  readonly issues: readonly ReviewIssue[];
}

export interface ReviewRouting {
  readonly groups: readonly RoutedIssueGroup[];
  readonly global: readonly ReviewIssue[];
}

export interface RoutingCharacter {
  readonly id: string;
  readonly name: string;
  readonly aliases?: readonly string[];
}

// NOTE: setting은 G-4(드로잉 능동 묘사) 전까지 매핑하지 않는다. grammar는 검수자 직접 수정이라 라우팅 대상이 아니다.
const categoryToAgent: Record<ReviewCategory, ReviewAgent | undefined> = {
  voice: 'persona',
  purpose: 'narrator',
  repetition: 'narrator',
  continuity: 'canon',
  grammar: undefined,
};

// 그룹 순서는 결정적으로 고정해 누적 재작성 결과를 재현 가능하게 한다.
const agentOrder: readonly ReviewAgent[] = ['canon', 'persona', 'narrator', 'setting'];

export function resolveAgent(category: ReviewCategory): ReviewAgent | undefined {
  return categoryToAgent[category];
}

function resolveCardIdFromExcerpt(
  excerpt: string | undefined,
  characters: readonly RoutingCharacter[],
): string | undefined {
  if (!excerpt) {
    return undefined;
  }

  const matches = characters.filter((character) => {
    const tokens = [character.name, ...(character.aliases ?? [])];
    return tokens.some((token) => token.length > 0 && excerpt.includes(token));
  });

  return matches.length === 1 ? matches[0]?.id : undefined;
}

export function adaptCritiqueIssues(
  issues: readonly DraftCritiqueIssue[],
  characters: readonly RoutingCharacter[],
): ReviewIssue[] {
  return issues.flatMap((issue) => {
    const agent = resolveAgent(issue.category);
    if (!agent) {
      return [{ severity: issue.severity, category: issue.category, note: issue.comment }];
    }

    const cardId =
      agent === 'persona' ? resolveCardIdFromExcerpt(issue.excerpt, characters) : undefined;
    const target: IssueTarget = cardId ? { agent, cardId } : { agent };

    return [{ severity: issue.severity, category: issue.category, target, note: issue.comment }];
  });
}

export function adaptContinuityIssues(issues: readonly ContinuityIssueLike[]): ReviewIssue[] {
  return issues.map((issue) => ({
    severity: issue.severity,
    category: 'continuity' as const,
    target: { agent: 'canon' as const },
    note: `"${issue.original}" — ${issue.reason}`,
  }));
}

export function routeReviewIssues(issues: readonly ReviewIssue[]): ReviewRouting {
  const global = issues.filter((issue) => !issue.target);
  const targeted = issues.filter((issue): issue is ReviewIssue & { target: IssueTarget } =>
    Boolean(issue.target),
  );

  const groups: RoutedIssueGroup[] = [];

  for (const agent of agentOrder) {
    const agentIssues = targeted.filter((issue) => issue.target.agent === agent);
    if (agentIssues.length === 0) {
      continue;
    }

    const cardIds = [
      ...new Set(
        agentIssues
          .map((issue) => issue.target.cardId)
          .filter((cardId): cardId is string => Boolean(cardId)),
      ),
    ];

    groups.push({ agent, cardIds, issues: agentIssues });
  }

  return { groups, global };
}

const agentScopeLines: Record<ReviewAgent, string> = {
  canon: '아래 설정 모순만 바로잡고, 나머지 본문은 그대로 둔다.',
  persona: '아래 캐릭터의 대사와 보이스만 다듬고, 다른 인물과 서술은 그대로 둔다.',
  narrator: '아래 서술·문체·반복 문제만 다듬고, 대사와 설정은 그대로 둔다.',
  setting: '아래 배경 묘사만 다듬고, 인물과 사건은 그대로 둔다.',
};

export function buildScopedInstructions(
  group: RoutedIssueGroup,
  resolveCardName?: (cardId: string) => string | undefined,
): string[] {
  const instructions: string[] = [agentScopeLines[group.agent]];

  if (group.agent === 'persona' && group.cardIds.length > 0) {
    const names = group.cardIds.map((cardId) => resolveCardName?.(cardId) ?? cardId);
    instructions.push(`대상 캐릭터: ${names.join(', ')}`);
  }

  for (const issue of group.issues) {
    instructions.push(issue.note);
  }

  return instructions;
}
