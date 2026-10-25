import { load as loadYaml } from 'js-yaml';
import { z } from 'zod';

export type FactKind = 'attribute' | 'knowledge' | 'number' | 'alias' | 'object' | 'relation';

export const factKinds: readonly FactKind[] = [
  'attribute',
  'knowledge',
  'number',
  'alias',
  'object',
  'relation',
];


const mechanicalKinds: readonly FactKind[] = ['number', 'alias'];

export interface Fact {
  id: string;
  kind: FactKind;
  statement: string;
  plant: string;
  recall: string[];
  check: string;
  patterns?: string[];
  antiPatterns?: string[];
}

const factSchema: z.ZodType<Fact> = z
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

export interface FactLedger {
  facts: Fact[];
}

export const factLedgerSchema: z.ZodType<FactLedger> = z.object({
  facts: z.array(factSchema).min(1),
});


export function parseFactLedger(text: string): FactLedger {
  return factLedgerSchema.parse(loadYaml(text));
}

export function isMechanicalKind(kind: FactKind): boolean {
  return mechanicalKinds.includes(kind);
}

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
