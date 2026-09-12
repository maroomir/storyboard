import { load as loadYaml } from 'js-yaml';
import { z } from 'zod';

// 트랙이 심은 사실을 뒤 씬이 받았는지 세는 원장. 엔진이 읽는 파일이 아니라 채점에만 쓴다.

export const factKinds = [
  'attribute',
  'knowledge',
  'number',
  'alias',
  'object',
  'relation',
] as const;

export type FactKind = (typeof factKinds)[number];

// NOTE: number 와 alias 만 기계가 센다. 한국어 산문에서 «밤 9시»는 9시·아홉 시·오후 9시·21시로
// 나오므로 표기를 하나만 적으면 멀쩡한 회수가 누락으로 잡힌다. 그래서 이 두 종류는 patterns 를
// 요구하고, antiPatterns 로 «뒤집힌 채 나온 경우»를 모순으로 구분한다.
const mechanicalKinds: readonly FactKind[] = ['number', 'alias'];

const factSchema = z
  .object({
    id: z.string().regex(/^F\d+$/, { message: 'fact id 는 F1 형식이어야 합니다.' }),
    kind: z.enum(factKinds),
    statement: z.string().min(1),
    plant: z.string().min(1),
    recall: z.array(z.string().min(1)).min(1),
    check: z.string().min(1),
    patterns: z.array(z.string().min(1)).optional(),
    antiPatterns: z.array(z.string().min(1)).optional(),
  })
  .refine(
    (fact) => !mechanicalKinds.includes(fact.kind) || (fact.patterns?.length ?? 0) > 0,
    { message: 'number·alias 사실은 patterns 를 적어야 기계가 셀 수 있습니다.', path: ['patterns'] },
  );

export const factLedgerSchema = z.object({
  facts: z.array(factSchema).min(1),
});

export type Fact = z.infer<typeof factSchema>;
export type FactLedger = z.infer<typeof factLedgerSchema>;

export function parseFactLedger(text: string): FactLedger {
  return factLedgerSchema.parse(loadYaml(text));
}

export function isMechanicalKind(kind: FactKind): boolean {
  return mechanicalKinds.includes(kind);
}

// 사실 하나가 씬 하나에서 회수돼야 하는 자리. 리포트의 분모가 이 개수다.
export interface RecallSlot {
  readonly factId: string;
  readonly kind: FactKind;
  readonly sceneStem: string;
}

export function recallSlotsOf(ledger: FactLedger): readonly RecallSlot[] {
  return ledger.facts.flatMap((fact) =>
    fact.recall.map((sceneStem) => ({ factId: fact.id, kind: fact.kind, sceneStem })),
  );
}
