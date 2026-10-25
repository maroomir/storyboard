import { critiqueCategoryLabels, scoreCritique } from '#model/contracts/draftReview';
import type {
  ContinuityIssueLike,
  CritiqueScore,
  DraftCritiqueIssue,
} from '#model/contracts/draftReview';
export interface ManuscriptReviewInput {
  readonly projectName: string;
  readonly sceneCount: number;
  readonly generatedAt: string;
  readonly continuityIssues: readonly ContinuityIssueLike[];
  readonly critiqueIssues: readonly DraftCritiqueIssue[];
  readonly revisedStems?: readonly string[];
  readonly unroutedHighCount?: number;
}

export function buildManuscriptReviewMarkdown(input: ManuscriptReviewInput): string {
  const highCount: number = input.critiqueIssues.filter(
    (issue) => issue.severity === 'high',
  ).length;
  const lowCount: number = input.critiqueIssues.length - highCount;
  const continuityHigh: number = input.continuityIssues.filter(
    (issue) => issue.severity === 'high',
  ).length;
  const continuityLow: number = input.continuityIssues.length - continuityHigh;
  const total: number = input.continuityIssues.length + input.critiqueIssues.length;

  const score: CritiqueScore = scoreCritique(input.critiqueIssues);
  const scoreLine: string = `- 비평 점수: ${score.overall}/100 (voice −${score.perCategory.voice} / purpose −${score.perCategory.purpose} / repetition −${score.perCategory.repetition})`;

  const sections: string[] = [
    '# 원고 최종 검사 보고서',
    `> 생성: ${input.generatedAt}\n> 대상: ${input.projectName} · 씬 ${input.sceneCount}개`,
  ];

  if (total === 0) {
    sections.push('발견된 이슈가 없습니다.');
    sections.push(scoreLine);

    const feedbackAfterClean: string | undefined = buildFeedbackSection(input);
    if (feedbackAfterClean) {
      sections.push(feedbackAfterClean);
    }

    return `${sections.join('\n\n')}\n`;
  }

  sections.push(
    [
      '## 요약',
      `- 설정 모순(continuity): ${input.continuityIssues.length}건 (high ${continuityHigh} / low ${continuityLow})`,
      `- 비평(critique): ${input.critiqueIssues.length}건 (high ${highCount} / low ${lowCount})`,
      scoreLine,
    ].join('\n'),
  );

  sections.push(buildContinuitySection(input.continuityIssues));
  sections.push(buildCritiqueSection(input.critiqueIssues));

  const feedback: string | undefined = buildFeedbackSection(input);
  if (feedback) {
    sections.push(feedback);
  }

  return `${sections.join('\n\n')}\n`;
}

function buildFeedbackSection(input: ManuscriptReviewInput): string | undefined {
  const revisedStems: readonly string[] = input.revisedStems ?? [];
  const unroutedHighCount: number = input.unroutedHighCount ?? 0;

  if (revisedStems.length === 0 && unroutedHighCount === 0) {
    return undefined;
  }

  const lines: string[] = [
    revisedStems.length > 0 ? `- 재작성한 씬: ${revisedStems.join(', ')}` : '- 재작성한 씬: 없음',
  ];

  if (unroutedHighCount > 0) {
    lines.push(`- 씬을 특정하지 못해 재작성하지 못한 high 이슈: ${unroutedHighCount}건`);
  }

  return `## 재작성 결과\n\n${lines.join('\n')}`;
}

function buildContinuitySection(issues: readonly ContinuityIssueLike[]): string {
  const lines: string[] = issues.map((issue) => `- "${issue.original}" — ${issue.reason}`);
  return `## 설정 모순 (continuity)\n\n${lines.length > 0 ? lines.join('\n') : '_없음_'}`;
}

function buildCritiqueSection(issues: readonly DraftCritiqueIssue[]): string {
  const lines: string[] = issues.map((issue) => {
    const excerpt: string = issue.excerpt ? ` ("${issue.excerpt}")` : '';
    return `- [${critiqueCategoryLabels[issue.category]}/${issue.severity}] ${issue.comment}${excerpt}`;
  });
  return `## 비평 (voice/purpose/repetition)\n\n${lines.length > 0 ? lines.join('\n') : '_없음_'}`;
}
