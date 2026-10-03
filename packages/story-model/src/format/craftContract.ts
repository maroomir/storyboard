import { z } from 'zod';

import craftContractData from './craftContract.params.json';

// 생성 프롬프트에 항상 주입되는 작법 규칙. 프로젝트가 아무 설정도 하지 않아도 기본 계약이 걸린다.
// 기본값은 craftContract.params.json 에 있고, 작가는 같은 꼴의 파일을 홈·작품에 두어 그 위에 덮는다.
export const craftContractSchema = z.object({
  banTelling: z.boolean(),
  motifRepeatLimit: z.number().int().positive(),
  stockGestureBlacklist: z.array(z.string()).readonly(),
  requireCharacterInterior: z.boolean(),
  actionClarity: z.boolean(),
  modulateDensity: z.boolean(),
  // 목표 분량이 없는 씬의 기본 예산을 씬 시드 길이의 배수로 정한다. 0이면 제한을 걸지 않는다.
  sceneLengthMultiplier: z.number().nonnegative(),
});

export type CraftContract = z.infer<typeof craftContractSchema>;

export const craftContractOverrideSchema = craftContractSchema.partial();

export type CraftContractOverride = z.infer<typeof craftContractOverrideSchema>;

export const defaultCraftContract: CraftContract = craftContractSchema.parse(craftContractData);

function mergeCraftContract(base: CraftContract, override: CraftContractOverride): CraftContract {
  return {
    banTelling: override.banTelling ?? base.banTelling,
    motifRepeatLimit: override.motifRepeatLimit ?? base.motifRepeatLimit,
    stockGestureBlacklist: override.stockGestureBlacklist ?? base.stockGestureBlacklist,
    requireCharacterInterior: override.requireCharacterInterior ?? base.requireCharacterInterior,
    actionClarity: override.actionClarity ?? base.actionClarity,
    modulateDensity: override.modulateDensity ?? base.modulateDensity,
    sceneLengthMultiplier: override.sceneLengthMultiplier ?? base.sceneLengthMultiplier,
  };
}

// The defaults in force: the bundled contract with the author's home and workspace files laid over
// it. A project's own `setting.craftContract` still resolves on top of these.
let craftContractDefaults: CraftContract = defaultCraftContract;

export function overrideCraftContractDefaults(override: CraftContractOverride): void {
  craftContractDefaults = mergeCraftContract(craftContractDefaults, override);
}

export function resetCraftContractDefaults(): void {
  craftContractDefaults = defaultCraftContract;
}

export function resolveCraftContract(override: CraftContractOverride | undefined): CraftContract {
  return override ? mergeCraftContract(craftContractDefaults, override) : craftContractDefaults;
}
