export type FloorCandidateKind = 'generated' | 'floor' | 'ceiling';

export interface FloorRanking {
  readonly readerId: string;
  readonly rankings: readonly (readonly FloorCandidateKind[])[];
}

export interface FloorGateResult {
  readonly passed: boolean;
  readonly failures: readonly string[];
  readonly abstained: readonly string[];
}

export type FloorCandidateLabel = '가' | '나' | '다';

export const floorCandidateLabels: readonly FloorCandidateLabel[] = ['가', '나', '다'];

export interface LabelledFloorCandidate {
  readonly label: string;
  readonly kind: FloorCandidateKind;
}

export function labelFloorCandidates<T extends { readonly kind: FloorCandidateKind }>(
  candidates: readonly T[],
): readonly (T & { readonly label: string })[] {
  return candidates.map((candidate, index) => ({
    ...candidate,
    label: floorCandidateLabels[index] ?? `${index + 1}`,
  }));
}

export function resolveFloorRanking(
  raw: readonly string[],
  candidates: readonly LabelledFloorCandidate[],
): readonly FloorCandidateKind[] | undefined {
  const resolved: (FloorCandidateKind | undefined)[] = raw.map((entry) =>
    resolveCandidate(entry, candidates),
  );

  if (resolved.some((kind) => kind === undefined)) {
    return undefined;
  }

  const ranking: readonly FloorCandidateKind[] = resolved as readonly FloorCandidateKind[];

  return ranking.length === candidates.length && new Set(ranking).size === candidates.length
    ? ranking
    : undefined;
}

function resolveCandidate(
  raw: string,
  candidates: readonly LabelledFloorCandidate[],
): FloorCandidateKind | undefined {
  const text: string = raw
    .replace(/\s+/g, '')
    .replace(/^원고/, '')
    .replace(/[.,)\]:·]+$/, '');
  const byLabel: LabelledFloorCandidate | undefined = candidates.find(
    (candidate) => text === candidate.label || text === `${candidate.label}번`,
  );

  if (byLabel !== undefined) {
    return byLabel.kind;
  }

  const positional: RegExpExecArray | null = /^(\d+)번?$/.exec(text);

  return positional === null ? undefined : candidates[Number(positional[1]) - 1]?.kind;
}

export function evaluateFloorGate(rankings: readonly FloorRanking[]): FloorGateResult {
  if (rankings.length === 0) {
    return { passed: false, failures: ['하한선 판정이 하나도 없습니다.'], abstained: [] };
  }

  const floorLast = (ranking: readonly FloorCandidateKind[]): boolean => ranking.at(-1) === 'floor';
  const failures: string[] = [];
  const abstained: string[] = [];
  let consistentPasses: number = 0;

  for (const entry of rankings) {
    const verdicts: boolean[] = entry.rankings.map(floorLast);

    if (verdicts.length > 0 && verdicts.every((passed) => passed)) {
      consistentPasses += 1;
    } else if (verdicts.length > 0 && verdicts.every((passed) => !passed)) {
      failures.push(
        `${entry.readerId} 가 훼손본을 꼴찌에 두지 않았습니다 (${entry.rankings.map((ranking) => ranking.join(' > ')).join(' / ')}).`,
      );
    } else {
      abstained.push(`${entry.readerId} 의 답이 보여 준 차례에 따라 바뀌었습니다.`);
    }
  }

  if (failures.length === 0 && consistentPasses === 0) {
    return { passed: false, failures: ['자리와 무관하게 답한 독자가 없습니다.'], abstained };
  }

  return { passed: failures.length === 0, failures, abstained };
}
