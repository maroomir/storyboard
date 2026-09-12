import { isMechanicalKind, recallSlotsOf, type Fact, type FactKind, type FactLedger } from '#sim/track/factLedger';

export type RecallStatus = 'recalled' | 'missing' | 'contradicted' | 'unverified';

export interface RecallResult {
  readonly factId: string;
  readonly kind: FactKind;
  readonly sceneStem: string;
  readonly status: RecallStatus;
  readonly evidence?: string;
}

export interface FactRecallReport {
  readonly slots: readonly RecallResult[];
  readonly recalled: number;
  readonly total: number;
  // NOTE: 회수율에 접지 않는다. 사실을 거꾸로 쓴 원고는 잊은 원고보다 나쁜데, 둘을 한 비율로
  // 평균 내면 그 차이가 사라진다.
  readonly contradicted: number;
}

// 심판이 판정해야 하는 자리. number·alias 는 여기 오지 않는다.
export type JudgeRecall = (input: {
  readonly fact: Fact;
  readonly sceneStem: string;
  readonly draft: string;
}) => Promise<{ readonly status: RecallStatus; readonly evidence?: string }>;

function scoreMechanically(fact: Fact, draft: string): RecallResult['status'] {
  const contradicted = (fact.antiPatterns ?? []).some((pattern) => draft.includes(pattern));
  if (contradicted) {
    return 'contradicted';
  }

  return (fact.patterns ?? []).some((pattern) => draft.includes(pattern)) ? 'recalled' : 'missing';
}

export async function scoreFactRecall(input: {
  readonly ledger: FactLedger;
  readonly draftsByScene: ReadonlyMap<string, string>;
  readonly judge: JudgeRecall;
}): Promise<FactRecallReport> {
  const factsById = new Map(input.ledger.facts.map((fact) => [fact.id, fact]));
  const slots: RecallResult[] = [];

  for (const slot of recallSlotsOf(input.ledger)) {
    const fact = factsById.get(slot.factId) as Fact;
    const draft = input.draftsByScene.get(slot.sceneStem);

    if (draft === undefined) {
      slots.push({ ...slot, status: 'unverified', evidence: '회수 씬의 원고가 없습니다.' });
      continue;
    }

    if (isMechanicalKind(fact.kind)) {
      slots.push({ ...slot, status: scoreMechanically(fact, draft) });
      continue;
    }

    const verdict = await input.judge({ fact, sceneStem: slot.sceneStem, draft });
    slots.push({
      ...slot,
      status: verdict.status,
      ...(verdict.evidence === undefined ? {} : { evidence: verdict.evidence }),
    });
  }

  return {
    slots,
    recalled: slots.filter((slot) => slot.status === 'recalled').length,
    total: slots.length,
    contradicted: slots.filter((slot) => slot.status === 'contradicted').length,
  };
}
