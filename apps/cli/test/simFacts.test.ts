import { describe, expect, it, vi } from 'vitest';

import { parseFactLedger, recallSlotsOf, scoreFactRecall } from '@storyboard/story-sim';

// 원장 채점은 리포트의 두 번째 숫자를 낸다. 표기 변형 때문에 멀쩡한 회수가 누락으로 잡히거나,
// 뒤집힌 사실이 단순 누락으로 뭉개지면 그 숫자는 쓸모가 없다.

const ledgerYaml = `
facts:
  - id: F1
    kind: attribute
    statement: 한도경의 왼손에 화상 흉터가 있다
    plant: "01"
    recall: ["03", "06"]
    check: 회수 씬 원고에 왼손 흉터가 나오고 오른손으로 바뀌지 않는다
  - id: F4
    kind: number
    statement: 만나기로 한 시각은 밤 9시다
    plant: "03"
    recall: ["06"]
    check: 약속 시각이 9시로 유지된다
    patterns: ["9시", "아홉 시", "스물한 시"]
    antiPatterns: ["10시", "여덟 시"]
  - id: F7
    kind: alias
    statement: 명치수를 사람들이 '늙은이'라 부른다
    plant: "06"
    recall: ["08"]
    check: 별칭이 그대로 쓰인다
    patterns: ["늙은이"]
`;

describe('fact ledger', () => {
  it('counts one recall slot per fact per recall scene', () => {
    expect(recallSlotsOf(parseFactLedger(ledgerYaml))).toHaveLength(4);
  });

  // 표기를 하나만 적으면 «아홉 시»가 누락으로 잡힌다. 그래서 이 두 종류는 patterns 를 요구한다.
  it('refuses a mechanical fact that carries no patterns', () => {
    const missingPatterns = `
facts:
  - id: F4
    kind: number
    statement: 밤 9시
    plant: "03"
    recall: ["06"]
    check: 시각이 유지된다
`;

    expect(() => parseFactLedger(missingPatterns)).toThrow(/patterns/);
  });

  it('refuses an id that is not in the F-number form', () => {
    expect(() =>
      parseFactLedger(`
facts:
  - id: fact-one
    kind: attribute
    statement: 무언가
    plant: "01"
    recall: ["02"]
    check: 확인
`),
    ).toThrow();
  });
});

describe('fact recall scoring', () => {
  const ledger = parseFactLedger(ledgerYaml);
  const neverJudge = vi.fn(async () => ({ status: 'missing' as const }));

  it('counts a mechanical fact through any of its spellings', async () => {
    const report = await scoreFactRecall({
      ledger,
      draftsByScene: new Map([['06', '두 사람은 아홉 시에 다시 만났다.']]),
      judge: neverJudge,
    });

    expect(report.slots.find((slot) => slot.factId === 'F4')?.status).toBe('recalled');
  });

  it('separates a contradicted fact from a forgotten one', async () => {
    const report = await scoreFactRecall({
      ledger,
      draftsByScene: new Map([['06', '두 사람은 10시에 다시 만났다.']]),
      judge: neverJudge,
    });

    expect(report.slots.find((slot) => slot.factId === 'F4')?.status).toBe('contradicted');
    expect(report.contradicted).toBe(1);
    // 모순은 회수로 세지 않되, 회수율 분모에는 남는다.
    expect(report.recalled).toBe(0);
    expect(report.total).toBe(4);
  });

  it('never sends a mechanical fact to the judge', async () => {
    const judge = vi.fn(async () => ({ status: 'recalled' as const }));

    await scoreFactRecall({
      ledger,
      draftsByScene: new Map([
        ['03', '본문'],
        ['06', '본문'],
        ['08', '본문'],
      ]),
      judge,
    });

    // F1 의 회수 자리 둘만 심판에게 간다. F4·F7 은 문자열 대조로 끝난다.
    expect(judge).toHaveBeenCalledTimes(2);
    expect(judge.mock.calls.every(([input]) => (input as { fact: { id: string } }).fact.id === 'F1')).toBe(true);
  });

  it('marks a slot unverified when the recall scene has no draft', async () => {
    const report = await scoreFactRecall({
      ledger,
      draftsByScene: new Map(),
      judge: neverJudge,
    });

    expect(report.slots.every((slot) => slot.status === 'unverified')).toBe(true);
    expect(report.recalled).toBe(0);
  });

  it('takes the judge verdict for a fact a machine cannot check', async () => {
    const report = await scoreFactRecall({
      ledger,
      draftsByScene: new Map([['03', '도경이 왼손을 내밀었다. 화상 자국이 보였다.']]),
      judge: vi.fn(async () => ({ status: 'recalled' as const, evidence: '왼손을 내밀었다' })),
    });

    const slot = report.slots.find((entry) => entry.factId === 'F1' && entry.sceneStem === '03');
    expect(slot?.status).toBe('recalled');
    expect(slot?.evidence).toBe('왼손을 내밀었다');
  });
});
