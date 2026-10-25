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
  readonly contradicted: number;
}

export interface RecallVerdict {
  readonly status: RecallStatus;
  readonly evidence?: string;
}

export type JudgeRecall = (input: {
  readonly fact: Fact;
  readonly sceneStem: string;
  readonly draft: string;
}) => Promise<RecallVerdict>;

function scoreMechanically(fact: Fact, draft: string): RecallResult['status'] {
  const contradicted: boolean = (fact.antiPatterns ?? []).some((pattern) => draft.includes(pattern));
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
  const factsById: Map<string, Fact> = new Map(input.ledger.facts.map((fact) => [fact.id, fact]));
  const slots: RecallResult[] = [];

  for (const slot of recallSlotsOf(input.ledger)) {
    const fact: Fact = factsById.get(slot.factId) as Fact;
    const draft: string | undefined = input.draftsByScene.get(slot.sceneStem);

    if (draft === undefined) {
      slots.push({ ...slot, status: 'unverified', evidence: '회수 씬의 원고가 없습니다.' });
      continue;
    }

    if (isMechanicalKind(fact.kind)) {
      slots.push({ ...slot, status: scoreMechanically(fact, draft) });
      continue;
    }

    const verdict: RecallVerdict = await input.judge({ fact, sceneStem: slot.sceneStem, draft });
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
