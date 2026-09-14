// 심판이 쓰레기를 꼴찌로 밀어내는지 먼저 확인한다. 못 밀면 그 회차의 점수는 버린다.
// 씬 하나에 대해 공통 독자 수만큼만 부르므로, 망가진 심판이 패널 전체가 아니라 네 번만 축낸다.

export type FloorCandidateKind = 'generated' | 'floor' | 'ceiling';

export interface FloorRanking {
  readonly readerId: string;
  // 같은 후보를 차례를 바꿔 보여 준 답들. 각각 좋은 순이고 마지막 자리가 꼴찌다.
  // NOTE: 한 차례만 물으면 자리 버릇과 판정을 가를 수 없다. gemma3:12b 는 같은 두 원고를 양쪽 차례로
  // 물었을 때 여덟 번 모두 뒤에 보인 쪽을 골랐다. 양쪽에서 같은 답을 낸 독자만 판정으로 센다.
  readonly rankings: readonly (readonly FloorCandidateKind[])[];
}

export interface FloorGateResult {
  readonly passed: boolean;
  readonly failures: readonly string[];
  // 차례에 따라 답이 바뀐 독자. 판정이 아니므로 통과에도 실패에도 세지 않고 적어만 둔다.
  readonly abstained: readonly string[];
}

// NOTE: 후보에 'generated'·'floor' 라고 써 붙여 보여 주면 심판은 원고를 읽지 않고도 답을 맞힌다.
// 그러면 관문이 «심판이 쓰레기를 가려내는가» 가 아니라 «심판이 라벨을 읽는가» 를 재게 된다.
// 그래서 보여 줄 때는 뜻이 없는 기호만 쓰고, 답을 받은 뒤 이쪽에서 후보로 되돌린다.
export const floorCandidateLabels = ['가', '나', '다'] as const;

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

// 심판은 기호 대신 자리를 세어 답하는 일이 잦다 ("1번" · "2"). 기호와 자리 둘 다로 되돌려 보되,
// 후보를 빠짐없이 한 번씩 덮지 못한 답은 «읽을 수 없음» 으로 돌린다. 반쯤 읽힌 순위로 관문을
// 통과시키면 그 회차의 눈금이 조용히 틀어진다.
export function resolveFloorRanking(
  raw: readonly string[],
  candidates: readonly LabelledFloorCandidate[],
): readonly FloorCandidateKind[] | undefined {
  const resolved = raw.map((entry) => resolveCandidate(entry, candidates));

  if (resolved.some((kind) => kind === undefined)) {
    return undefined;
  }

  const ranking = resolved as readonly FloorCandidateKind[];

  return ranking.length === candidates.length && new Set(ranking).size === candidates.length
    ? ranking
    : undefined;
}

function resolveCandidate(
  raw: string,
  candidates: readonly LabelledFloorCandidate[],
): FloorCandidateKind | undefined {
  // 「원고 가」·「가.」·「  나 」 처럼 꾸며 답해도 같은 후보로 본다.
  const text = raw
    .replace(/\s+/g, '')
    .replace(/^원고/, '')
    .replace(/[.,)\]:·]+$/, '');
  const byLabel = candidates.find(
    (candidate) => text === candidate.label || text === `${candidate.label}번`,
  );

  if (byLabel !== undefined) {
    return byLabel.kind;
  }

  const positional = /^(\d+)번?$/.exec(text);

  return positional === null ? undefined : candidates[Number(positional[1]) - 1]?.kind;
}

export function evaluateFloorGate(rankings: readonly FloorRanking[]): FloorGateResult {
  if (rankings.length === 0) {
    return { passed: false, failures: ['하한선 판정이 하나도 없습니다.'], abstained: [] };
  }

  const floorLast = (ranking: readonly FloorCandidateKind[]): boolean => ranking.at(-1) === 'floor';
  const failures: string[] = [];
  const abstained: string[] = [];
  let consistentPasses = 0;

  for (const entry of rankings) {
    const verdicts = entry.rankings.map(floorLast);

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

  // 일관된 판정이 하나도 없으면 관문이 아무것도 재지 못한 것이다. 통과로 세면 안 된다.
  if (failures.length === 0 && consistentPasses === 0) {
    return { passed: false, failures: ['자리와 무관하게 답한 독자가 없습니다.'], abstained };
  }

  return { passed: failures.length === 0, failures, abstained };
}
