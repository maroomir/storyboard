import type { BibleCandidateRecord } from './files/bibleCandidates';
import { resolveSceneOrder } from '#model/format/scene';
import type { BibleFact, StoryBible } from '#model/format/bible';
export interface CanonDiffResult {
  readonly pending: BibleFact[];
}

function factKey(fact: BibleFact): string {
  return `${fact.subject.kind}:${fact.subject.id}:${fact.key}`;
}

export function diffCandidatesAgainstCanon(
  canon: StoryBible,
  candidateRecords: readonly BibleCandidateRecord[],
): CanonDiffResult {
  const canonKeys: Set<string> = new Set(
    canon.facts.filter((fact) => fact.status === 'canon').map(factKey),
  );
  const seen: Set<string> = new Set<string>();
  const pending: BibleFact[] = [];

  for (const record of candidateRecords) {
    for (const fact of record.facts) {
      const key: string = factKey(fact);
      if (canonKeys.has(key) || seen.has(key)) {
        continue;
      }
      seen.add(key);
      pending.push(fact);
    }
  }

  return { pending };
}

export function buildCanonDiffMarkdown(
  projectName: string,
  pending: readonly BibleFact[],
  canon?: StoryBible,
): string {
  const sections: string[] = ['# Canon Diff (미승격 설정 후보)', `> 대상: ${projectName}`];

  if (pending.length === 0) {
    sections.push('미승격 설정 후보가 없습니다.');
  } else {
    const lines: string[] = pending.map(
      (fact) => `- [${fact.subject.kind}:${fact.subject.id}] ${fact.key}: ${fact.value}`,
    );
    sections.push(
      '아직 `canon.yaml`로 승격되지 않은 자동 추출 설정입니다. `Promote Bible Candidates to Canon`으로 확정하세요.',
      lines.join('\n'),
    );
  }

  const timeline: string | undefined = canon ? buildCanonTimelineSection(canon) : undefined;
  if (timeline) {
    sections.push(timeline);
  }

  return `${sections.join('\n\n')}\n`;
}

function rangeStart(fact: BibleFact): number {
  return fact.validFrom === undefined
    ? Number.NEGATIVE_INFINITY
    : (resolveSceneOrder(fact.validFrom) ?? Number.NEGATIVE_INFINITY);
}

function formatBound(bound: string | number): string {
  const order: number | undefined = resolveSceneOrder(bound);
  return order === undefined ? String(bound) : String(order).padStart(2, '0');
}

function formatRangeLabel(fact: BibleFact): string {
  const left: string = fact.validFrom === undefined ? '…' : formatBound(fact.validFrom);
  const right: string = fact.validUntil === undefined ? '' : formatBound(fact.validUntil);
  return `${left}–${right}`;
}

function buildCanonTimelineSection(canon: StoryBible): string | undefined {
  const groups: Map<string, BibleFact[]> = new Map<string, BibleFact[]>();

  for (const fact of canon.facts) {
    if (fact.status !== 'canon') {
      continue;
    }
    const key: string = factKey(fact);
    const group: BibleFact[] | undefined = groups.get(key);
    if (group) {
      group.push(fact);
    } else {
      groups.set(key, [fact]);
    }
  }

  const blocks: string[] = [];

  for (const facts of groups.values()) {
    if (facts.length < 2) {
      continue;
    }
    const sorted: BibleFact[] = [...facts].sort((left, right) => {
      const leftStart: number = rangeStart(left);
      const rightStart: number = rangeStart(right);
      if (leftStart === rightStart) {
        return 0;
      }
      return leftStart < rightStart ? -1 : 1;
    });
    const { subject, key } = facts[0] as BibleFact;
    const lines: string[] = sorted.map((fact) => `- \`${formatRangeLabel(fact)}\`: ${fact.value}`);
    blocks.push([`### [${subject.kind}:${subject.id}] ${key}`, ...lines].join('\n'));
  }

  if (blocks.length === 0) {
    return undefined;
  }

  return ['## 설정 변경 타임라인', ...blocks].join('\n\n');
}
