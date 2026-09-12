// 심판이 쓰레기를 꼴찌로 밀어내는지 먼저 확인한다. 못 밀면 그 회차의 점수는 버린다.
// 씬 하나에 대해 공통 독자 수만큼만 부르므로, 망가진 심판이 패널 전체가 아니라 네 번만 축낸다.

export type FloorCandidateKind = 'generated' | 'floor' | 'ceiling';

export interface FloorRanking {
  readonly readerId: string;
  // 좋은 순. 마지막 자리가 꼴찌다.
  readonly ranking: readonly FloorCandidateKind[];
}

export interface FloorGateResult {
  readonly passed: boolean;
  readonly failures: readonly string[];
}

export function evaluateFloorGate(rankings: readonly FloorRanking[]): FloorGateResult {
  if (rankings.length === 0) {
    return { passed: false, failures: ['하한선 판정이 하나도 없습니다.'] };
  }

  const failures = rankings
    .filter((entry) => entry.ranking.at(-1) !== 'floor')
    .map(
      (entry) =>
        `${entry.readerId} 가 훼손본을 꼴찌에 두지 않았습니다 (${entry.ranking.join(' > ')}).`,
    );

  return { passed: failures.length === 0, failures };
}
